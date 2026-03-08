/**
 * LobsterBoard Agent HTTP Server
 * 
 * Supports encrypted communication via ECDH key exchange + AES-256-GCM.
 * Clients must complete /handshake before receiving encrypted /stats.
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { collectStats } = require('./stats.js');
const { collectDockerStats } = require('./docker.js');
const { collectOpenClawStats } = require('./openclaw.js');
const { collectAiUsage } = require('./ai-usage.js');
const { deriveSharedSecret, encrypt } = require('./crypto.js');

const CONFIG_DIR = path.join(os.homedir(), '.lobsterboard-agent');
const CONFIG_FILE = path.join(CONFIG_DIR, 'config.json');

// Load config from disk (for reading current clients)
function loadConfig() {
  try {
    return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
  } catch (e) {
    return {};
  }
}

// Save config to disk
function saveConfig(config) {
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
}

// Parse JSON body from request
function parseJsonBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        resolve(JSON.parse(body));
      } catch (e) {
        reject(new Error('Invalid JSON'));
      }
    });
    req.on('error', reject);
  });
}

function startServer(config) {
  const { apiKey, port, host, serverName, enableDocker, enableOpenClaw, enableAiUsage, ecdhPrivateKey, ecdhPublicKey } = config;

  // In-memory cache of shared secrets for connected clients (keyed by client ID)
  const clientSecrets = new Map();
  
  // Load existing clients from config
  if (config.clients) {
    for (const [clientId, clientData] of Object.entries(config.clients)) {
      if (clientData.sharedSecret) {
        clientSecrets.set(clientId, Buffer.from(clientData.sharedSecret, 'base64'));
      }
    }
  }

  const server = http.createServer(async (req, res) => {
    // CORS headers for browser requests
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', 'X-API-Key, X-Client-ID, Content-Type');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');

    // Handle preflight
    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    // Check API key for all endpoints
    const providedKey = req.headers['x-api-key'];
    if (providedKey !== apiKey) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Invalid or missing API key' }));
      return;
    }

    const url = new URL(req.url, `http://${req.headers.host}`);
    const pathname = url.pathname;

    // === HANDSHAKE ENDPOINT ===
    // Client sends their public key, we respond with ours
    // Both sides derive the same shared secret
    if (req.method === 'POST' && pathname === '/handshake') {
      try {
        if (!ecdhPrivateKey || !ecdhPublicKey) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Agent not configured for encryption. Run "lobsterboard-agent init" again.' }));
          return;
        }

        const body = await parseJsonBody(req);
        const { clientId, publicKey: clientPublicKey } = body;

        if (!clientId || !clientPublicKey) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Missing clientId or publicKey' }));
          return;
        }

        // Derive shared secret
        const sharedSecret = deriveSharedSecret(ecdhPrivateKey, clientPublicKey);
        
        // Store in memory
        clientSecrets.set(clientId, sharedSecret);
        
        // Persist to config file
        const currentConfig = loadConfig();
        if (!currentConfig.clients) currentConfig.clients = {};
        currentConfig.clients[clientId] = {
          publicKey: clientPublicKey,
          sharedSecret: sharedSecret.toString('base64'),
          connectedAt: new Date().toISOString(),
        };
        saveConfig(currentConfig);

        console.log(`🔐 Handshake completed with client: ${clientId}`);

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          publicKey: ecdhPublicKey,
          serverName,
          encrypted: true,
        }));
      } catch (err) {
        console.error('Handshake error:', err.message);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      }
      return;
    }

    // === STATS ENDPOINT ===
    if (req.method === 'GET' && pathname === '/stats') {
      try {
        const stats = await collectStats();
        stats.serverName = serverName;
        stats.timestamp = new Date().toISOString();

        // Add Docker stats if enabled
        if (enableDocker) {
          stats.docker = await collectDockerStats();
        }

        // Add OpenClaw stats if enabled
        if (enableOpenClaw) {
          stats.openclaw = await collectOpenClawStats();
        }

        // Add AI usage stats if enabled
        if (enableAiUsage) {
          stats.aiUsage = await collectAiUsage();
        }

        // Check if client wants encrypted response
        const clientId = req.headers['x-client-id'];
        const sharedSecret = clientId ? clientSecrets.get(clientId) : null;

        if (clientId && sharedSecret) {
          // Encrypted response
          const encrypted = encrypt(stats, sharedSecret);
          res.writeHead(200, { 
            'Content-Type': 'application/json',
            'X-Encrypted': 'true',
          });
          res.end(JSON.stringify({ encrypted }));
        } else if (clientId && !sharedSecret) {
          // Client claims to have handshaked but we don't have their secret
          res.writeHead(403, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ 
            error: 'Handshake required',
            message: 'Please complete /handshake first or remove X-Client-ID header for plaintext.',
          }));
        } else {
          // No client ID = plaintext response (backward compatible)
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(stats));
        }
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      }
      return;
    }

    // === HEALTH ENDPOINT ===
    if (req.method === 'GET' && pathname === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ 
        status: 'ok', 
        serverName,
        encrypted: !!ecdhPublicKey,
        version: require('../package.json').version,
      }));
      return;
    }

    // === ROOT ENDPOINT ===
    if (req.method === 'GET' && pathname === '/') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        name: 'LobsterBoard Agent',
        version: require('../package.json').version,
        serverName,
        encrypted: !!ecdhPublicKey,
        endpoints: ['/stats', '/health', '/handshake'],
      }));
      return;
    }

    // 404
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Not found' }));
  });

  server.listen(port, host, () => {
    console.log(`
🦞 LobsterBoard Agent running!

   Server:     http://${host}:${port}
   Name:       ${serverName}
   Encryption: ${ecdhPublicKey ? '🔐 enabled' : '⚠️ disabled (run init again)'}
   
   Endpoints:
     POST /handshake - Key exchange (requires X-API-Key)
     GET  /stats     - System stats (encrypted if handshaked)
     GET  /health    - Health check

   Press Ctrl+C to stop
`);
  });

  // Graceful shutdown
  process.on('SIGTERM', () => server.close(() => process.exit(0)));
  process.on('SIGINT', () => server.close(() => process.exit(0)));
}

module.exports = { startServer };
