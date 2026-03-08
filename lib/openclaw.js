/**
 * OpenClaw stats collection (optional)
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

const OPENCLAW_DIR = path.join(os.homedir(), '.openclaw');
const CRON_FILE = path.join(OPENCLAW_DIR, 'cron', 'jobs.json');
const SESSIONS_DIR = path.join(OPENCLAW_DIR, 'sessions');

async function collectOpenClawStats() {
  // Check if OpenClaw is installed
  if (!fs.existsSync(OPENCLAW_DIR)) {
    return { installed: false };
  }

  const stats = { installed: true };

  // Cron jobs
  try {
    if (fs.existsSync(CRON_FILE)) {
      const data = JSON.parse(fs.readFileSync(CRON_FILE, 'utf8'));
      const jobs = data.jobs || [];
      stats.cron = {
        total: jobs.length,
        enabled: jobs.filter(j => j.enabled !== false).length,
        jobs: jobs.slice(0, 10).map(j => ({
          name: j.name,
          schedule: j.schedule?.expr || j.schedule?.kind,
          enabled: j.enabled !== false,
        })),
      };
    }
  } catch (e) {
    stats.cron = { error: e.message };
  }

  // Sessions (count recent activity)
  try {
    if (fs.existsSync(SESSIONS_DIR)) {
      const sessionFiles = fs.readdirSync(SESSIONS_DIR)
        .filter(f => f.endsWith('.json'));
      
      // Count sessions active in last 24h
      const oneDayAgo = Date.now() - 24 * 60 * 60 * 1000;
      let recentCount = 0;
      
      for (const file of sessionFiles.slice(0, 100)) {
        try {
          const filePath = path.join(SESSIONS_DIR, file);
          const stat = fs.statSync(filePath);
          if (stat.mtimeMs > oneDayAgo) {
            recentCount++;
          }
        } catch (e) { /* skip */ }
      }

      stats.sessions = {
        total: sessionFiles.length,
        recent24h: recentCount,
      };
    }
  } catch (e) {
    stats.sessions = { error: e.message };
  }

  // Gateway status (check if process is running)
  try {
    const { execSync } = require('child_process');
    const result = execSync('pgrep -f "openclaw.*gateway" || true', { encoding: 'utf8' });
    stats.gateway = {
      running: result.trim().length > 0,
    };
  } catch (e) {
    stats.gateway = { running: false };
  }

  return stats;
}

module.exports = { collectOpenClawStats };
