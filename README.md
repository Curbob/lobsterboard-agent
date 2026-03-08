# 🦞 LobsterBoard Agent

A lightweight stats agent for remote [LobsterBoard](https://github.com/Curbob/LobsterBoard) monitoring. Run it on your VPS or remote servers, then connect from your local LobsterBoard dashboard.

## Features

- **System stats** — CPU, memory, disk, network, uptime
- **Docker stats** — Container list and status (optional)
- **OpenClaw stats** — Cron jobs, sessions, gateway status (optional)
- **End-to-end encryption** — ECDH key exchange + AES-256-GCM (automatic)
- **API key auth** — Secure access to your server stats
- **Lightweight** — Minimal footprint, runs anywhere Node runs
- **Multi-server** — Monitor multiple servers from one LobsterBoard

## Quick Start

```bash
# Install globally
npm install -g lobsterboard-agent

# Initialize (generates API key)
lobsterboard-agent init

# Start the agent
lobsterboard-agent serve
```

## VPS Setup (Ubuntu/Debian)

SSH into your VPS and run:

```bash
# Install Node.js if not present
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs

# Install the agent
sudo npm install -g lobsterboard-agent

# Initialize and save your API key
lobsterboard-agent init

# Start in background (survives logout)
lobsterboard-agent serve > /tmp/agent.log 2>&1 &
disown

# Verify it's running
curl -H "X-API-Key: YOUR_KEY" http://localhost:9090/health
```

### Open Firewall Port

```bash
# UFW (Ubuntu)
sudo ufw allow 9090

# Or via your VPS provider's firewall panel
```

### Test from Local Machine

```bash
curl -H "X-API-Key: YOUR_KEY" http://YOUR_VPS_IP:9090/stats
```

## Commands

| Command | Description |
|---------|-------------|
| `init` | Initialize config and generate API key |
| `serve` | Start the stats server |
| `rotate-key` | Generate a new API key (invalidates old one) |
| `show-key` | Display current API key |
| `status` | Show agent configuration |

## Options

```bash
lobsterboard-agent serve --port=9090    # Custom port (default: 9090)
lobsterboard-agent serve --host=0.0.0.0 # Bind address (default: 0.0.0.0)
lobsterboard-agent serve --name=prod-1  # Server name for identification
```

## API Endpoints

All endpoints require the `X-API-Key` header.

| Endpoint | Description |
|----------|-------------|
| `POST /handshake` | Key exchange for encrypted communication |
| `GET /stats` | Full system stats (encrypted if handshaked) |
| `GET /health` | Health check |

### Encryption Flow

1. Client sends `POST /handshake` with `{ clientId, publicKey }`
2. Agent responds with its public key
3. Both derive shared secret using ECDH
4. Client sends `GET /stats` with `X-Client-ID` header
5. Agent returns encrypted response: `{ encrypted: "base64..." }`
6. Client decrypts using shared secret

### Example Request

```bash
curl -H "X-API-Key: sk_your_key_here" http://your-server:9090/stats
```

### Example Response

```json
{
  "serverName": "prod-vps-1",
  "timestamp": "2026-03-07T12:00:00.000Z",
  "hostname": "vps-12345",
  "platform": "linux",
  "distro": "Ubuntu",
  "uptime": 1234567,
  "cpu": {
    "model": "Intel Xeon",
    "cores": 2,
    "usage": 12.5
  },
  "memory": {
    "total": 2147483648,
    "used": 1073741824,
    "percent": 50.0
  },
  "disk": {
    "total": 42949672960,
    "used": 21474836480,
    "percent": 50.0
  },
  "network": {
    "rxSec": 1024,
    "txSec": 512
  },
  "docker": {
    "available": true,
    "running": 3,
    "total": 5,
    "containers": [...]
  },
  "openclaw": {
    "installed": true,
    "gateway": { "running": true },
    "cron": { "total": 5, "enabled": 4 },
    "sessions": { "total": 12, "recent24h": 3 }
  }
}
```

## Configuration

Config is stored in `~/.lobsterboard-agent/config.json`:

```json
{
  "apiKey": "sk_...",
  "port": 9090,
  "host": "0.0.0.0",
  "serverName": "my-vps",
  "enableDocker": true,
  "enableOpenClaw": true
}
```

## Run as Service

### systemd (Linux)

```bash
sudo cat > /etc/systemd/system/lobsterboard-agent.service << 'EOF'
[Unit]
Description=LobsterBoard Agent
After=network.target

[Service]
Type=simple
User=your-user
ExecStart=/usr/bin/lobsterboard-agent serve
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl enable lobsterboard-agent
sudo systemctl start lobsterboard-agent
```

### pm2

```bash
pm2 start lobsterboard-agent -- serve
pm2 save
pm2 startup
```

## Connecting from LobsterBoard

1. Open LobsterBoard and click **🖥️ Servers** in the header
2. Fill in the form:
   - **Name**: A friendly name (e.g., "Production VPS")
   - **URL**: `http://YOUR_IP:9090` (must include `http://`)
   - **API Key**: The key from `lobsterboard-agent init`
3. Click **Test Connection** — should show ✓ Connected
4. Click **Add Server**

### Adding Widgets

1. Add a widget (Uptime Monitor, CPU/Memory, Disk, Network, or Docker)
2. Select the widget to open properties panel
3. Choose your server from the **Server** dropdown
4. Save and preview!

### Troubleshooting

| Issue | Solution |
|-------|----------|
| "Failed to parse URL" | Make sure URL starts with `http://` |
| Connection timeout | Check firewall, ensure port 9090 is open |
| 401 Unauthorized | Verify API key is correct |
| Agent stops when terminal closes | Use `disown` after starting (see VPS Setup) |

## Security

### Encryption (v0.2.0+)

All communication between LobsterBoard and the agent is **encrypted by default**:

1. **Key Exchange** — When you add a server in LobsterBoard, it performs an ECDH handshake with the agent
2. **Shared Secret** — Both sides derive a shared 256-bit key (never transmitted)
3. **Encrypted Stats** — All `/stats` responses are encrypted with AES-256-GCM

This means your server stats are protected even over plain HTTP. No extra setup required!

**Note:** The API key is still sent in headers for authentication. For maximum security, you can also:
- Run behind a reverse proxy with HTTPS
- Use Tailscale/WireGuard for encrypted tunneling
- Limit access by IP via firewall rules

### Best Practices

- Always use an API key (never disable it)
- Rotate keys periodically with `lobsterboard-agent rotate-key` (this also regenerates encryption keys)
- Use firewall rules to limit access by IP if possible

## License

MIT

---

Made with 🦞 by [Curbob](https://github.com/Curbob)
