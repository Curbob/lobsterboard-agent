#!/usr/bin/env node

/**
 * LobsterBoard Agent CLI
 * 
 * Commands:
 *   init        - Initialize config and generate API key
 *   serve       - Start the stats server
 *   rotate-key  - Generate a new API key
 *   show-key    - Display current API key
 *   status      - Show agent status
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const os = require('os');

const CONFIG_DIR = path.join(os.homedir(), '.lobsterboard-agent');
const CONFIG_FILE = path.join(CONFIG_DIR, 'config.json');

const DEFAULT_CONFIG = {
  apiKey: null,
  port: 9090,
  host: '0.0.0.0',
  enableDocker: true,
  enableOpenClaw: true,
  enableAiUsage: true,
  serverName: os.hostname(),
  // ECDH key pair for encrypted communication
  ecdhPublicKey: null,
  ecdhPrivateKey: null,
  // Connected clients with their shared secrets
  clients: {},
};

// Ensure config directory exists
function ensureConfigDir() {
  if (!fs.existsSync(CONFIG_DIR)) {
    fs.mkdirSync(CONFIG_DIR, { recursive: true });
  }
}

// Load config
function loadConfig() {
  ensureConfigDir();
  if (fs.existsSync(CONFIG_FILE)) {
    try {
      return { ...DEFAULT_CONFIG, ...JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8')) };
    } catch (e) {
      console.error('Error reading config:', e.message);
      return { ...DEFAULT_CONFIG };
    }
  }
  return { ...DEFAULT_CONFIG };
}

// Save config
function saveConfig(config) {
  ensureConfigDir();
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
}

// Generate API key
function generateApiKey() {
  return 'sk_' + crypto.randomBytes(24).toString('base64url');
}

// Commands
const commands = {
  init() {
    const config = loadConfig();
    if (config.apiKey) {
      console.log('Config already exists.');
      console.log('Use "lobsterboard-agent rotate-key" to generate a new key.');
      console.log('\nCurrent config:', CONFIG_FILE);
      return;
    }
    
    config.apiKey = generateApiKey();
    
    // Generate ECDH key pair for encrypted communication
    const { generateKeyPair } = require('../lib/crypto.js');
    const keys = generateKeyPair();
    config.ecdhPublicKey = keys.publicKey;
    config.ecdhPrivateKey = keys.privateKey;
    config.clients = {};
    
    saveConfig(config);
    
    console.log('✅ LobsterBoard Agent initialized!\n');
    console.log('Your API key (save this!):\n');
    console.log(`   ${config.apiKey}\n`);
    console.log('🔐 Encryption keys generated (ECDH P-256)');
    console.log('Config saved to:', CONFIG_FILE);
    console.log('\nStart the agent with:');
    console.log('   lobsterboard-agent serve');
  },

  serve() {
    const config = loadConfig();
    
    if (!config.apiKey) {
      console.error('No API key configured. Run "lobsterboard-agent init" first.');
      process.exit(1);
    }
    
    // Import and start server
    const { startServer } = require('../lib/server.js');
    startServer(config);
  },

  'rotate-key'() {
    const config = loadConfig();
    const oldKey = config.apiKey;
    config.apiKey = generateApiKey();
    
    // Also regenerate ECDH keys and clear clients (they'll need to re-handshake)
    const { generateKeyPair } = require('../lib/crypto.js');
    const keys = generateKeyPair();
    config.ecdhPublicKey = keys.publicKey;
    config.ecdhPrivateKey = keys.privateKey;
    config.clients = {};
    
    saveConfig(config);
    
    console.log('✅ API key rotated!\n');
    if (oldKey) {
      console.log('Old key (now invalid):', oldKey.slice(0, 10) + '...');
    }
    console.log('New key:', config.apiKey);
    console.log('🔐 Encryption keys regenerated');
    console.log('\nAll connected clients will need to reconnect.');
    console.log('Restart the agent to apply.');
  },

  'show-key'() {
    const config = loadConfig();
    if (!config.apiKey) {
      console.log('No API key configured. Run "lobsterboard-agent init" first.');
      return;
    }
    console.log('API Key:', config.apiKey);
  },

  status() {
    const config = loadConfig();
    console.log('LobsterBoard Agent Status\n');
    console.log('Config file:', CONFIG_FILE);
    console.log('API key:', config.apiKey ? config.apiKey.slice(0, 10) + '...' : '(not set)');
    console.log('Encryption:', config.ecdhPublicKey ? '🔐 enabled (ECDH P-256 + AES-256-GCM)' : '⚠️ not configured');
    console.log('Connected clients:', Object.keys(config.clients || {}).length);
    console.log('Port:', config.port);
    console.log('Host:', config.host);
    console.log('Server name:', config.serverName);
    console.log('Docker stats:', config.enableDocker ? 'enabled' : 'disabled');
    console.log('OpenClaw stats:', config.enableOpenClaw ? 'enabled' : 'disabled');
    console.log('AI usage stats:', config.enableAiUsage ? 'enabled' : 'disabled');
  },

  help() {
    console.log(`
LobsterBoard Agent - Remote stats for LobsterBoard dashboards

Usage: lobsterboard-agent <command> [options]

Commands:
  init          Initialize config and generate API key
  serve         Start the stats server
  rotate-key    Generate a new API key (invalidates old one)
  show-key      Display current API key
  status        Show agent configuration
  help          Show this help

Options:
  --port=PORT   Override port (default: 9090)
  --host=HOST   Override host (default: 0.0.0.0)
  --name=NAME   Set server name for identification

Examples:
  lobsterboard-agent init
  lobsterboard-agent serve
  lobsterboard-agent serve --port=8888
`);
  }
};

// Parse args
const args = process.argv.slice(2);
let command = args[0] || 'help';

// Parse options
const options = {};
args.slice(1).forEach(arg => {
  const match = arg.match(/^--(\w+)=(.+)$/);
  if (match) {
    options[match[1]] = match[2];
  }
});

// Apply option overrides to config for serve command
if (command === 'serve' && Object.keys(options).length > 0) {
  const config = loadConfig();
  if (options.port) config.port = parseInt(options.port, 10);
  if (options.host) config.host = options.host;
  if (options.name) config.serverName = options.name;
  saveConfig(config);
}

// Run command
if (commands[command]) {
  commands[command]();
} else {
  console.error(`Unknown command: ${command}`);
  commands.help();
  process.exit(1);
}
