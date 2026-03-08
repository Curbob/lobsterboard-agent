/**
 * LobsterBoard Agent HTTP Server
 */

const http = require('http');
const { collectStats } = require('./stats.js');
const { collectDockerStats } = require('./docker.js');
const { collectOpenClawStats } = require('./openclaw.js');

function startServer(config) {
  const { apiKey, port, host, serverName, enableDocker, enableOpenClaw } = config;

  const server = http.createServer(async (req, res) => {
    // CORS headers for browser requests
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', 'X-API-Key, Content-Type');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');

    // Handle preflight
    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    // Check API key
    const providedKey = req.headers['x-api-key'];
    if (providedKey !== apiKey) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Invalid or missing API key' }));
      return;
    }

    const url = new URL(req.url, `http://${req.headers.host}`);
    const pathname = url.pathname;

    // Routes
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

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(stats));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      }
      return;
    }

    if (req.method === 'GET' && pathname === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok', serverName }));
      return;
    }

    if (req.method === 'GET' && pathname === '/') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        name: 'LobsterBoard Agent',
        version: require('../package.json').version,
        serverName,
        endpoints: ['/stats', '/health']
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

   Server:  http://${host}:${port}
   Name:    ${serverName}
   
   Endpoints:
     GET /stats   - System stats (requires X-API-Key header)
     GET /health  - Health check (requires X-API-Key header)

   Press Ctrl+C to stop
`);
  });

  // Graceful shutdown
  process.on('SIGTERM', () => server.close(() => process.exit(0)));
  process.on('SIGINT', () => server.close(() => process.exit(0)));
}

module.exports = { startServer };
