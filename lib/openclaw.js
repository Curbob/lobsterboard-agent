/**
 * OpenClaw stats collection (optional)
 * 
 * Collects comprehensive OpenClaw data for remote monitoring:
 * - Version info
 * - Gateway status
 * - Auth status
 * - Cron jobs (with run history)
 * - Sessions
 * - System logs
 * - Today's activity
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const { execSync } = require('child_process');

const OPENCLAW_DIR = path.join(os.homedir(), '.openclaw');
const CRON_FILE = path.join(OPENCLAW_DIR, 'cron', 'jobs.json');
const CRON_RUNS_DIR = path.join(OPENCLAW_DIR, 'cron', 'runs');
const SESSIONS_DIR = path.join(OPENCLAW_DIR, 'sessions');
const LOGS_DIR = path.join(OPENCLAW_DIR, 'logs');
const CONFIG_FILE = path.join(OPENCLAW_DIR, 'openclaw.json');
const AUTH_PROFILES_DIR = path.join(OPENCLAW_DIR, 'agents', 'main', 'agent');

async function collectOpenClawStats() {
  // Check if OpenClaw is installed
  if (!fs.existsSync(OPENCLAW_DIR)) {
    return { installed: false };
  }

  const stats = { installed: true };

  // Get version
  try {
    stats.version = execSync('openclaw --version 2>/dev/null', { encoding: 'utf8', timeout: 5000 }).trim();
  } catch (e) {
    stats.version = 'unknown';
  }

  // Gateway status
  try {
    const result = execSync('pgrep -f "openclaw.*gateway" || true', { encoding: 'utf8' });
    stats.gateway = {
      running: result.trim().length > 0,
    };
  } catch (e) {
    stats.gateway = { running: false };
  }

  // Auth status
  try {
    const authProfilesFile = path.join(AUTH_PROFILES_DIR, 'auth-profiles.json');
    if (fs.existsSync(authProfilesFile)) {
      const authProfiles = JSON.parse(fs.readFileSync(authProfilesFile, 'utf8'));
      const defaultProfile = authProfiles['anthropic:default'] || authProfiles['anthropic:clawdfull'];
      if (defaultProfile) {
        const isOAuth = defaultProfile.mode === 'token' || !!defaultProfile.accessToken;
        stats.auth = {
          mode: isOAuth ? 'Monthly' : 'API',
          provider: 'anthropic',
        };
      }
    }
    if (!stats.auth) {
      stats.auth = { mode: 'unknown' };
    }
  } catch (e) {
    stats.auth = { mode: 'unknown', error: e.message };
  }

  // Cron jobs with run history
  try {
    if (fs.existsSync(CRON_FILE)) {
      const data = JSON.parse(fs.readFileSync(CRON_FILE, 'utf8'));
      const jobs = data.jobs || [];
      
      // Get last run info for each job
      const jobsWithRuns = jobs.map(j => {
        const jobInfo = {
          id: j.id,
          name: j.name || j.id,
          enabled: j.enabled !== false,
          schedule: j.schedule?.expr || j.schedule?.kind || 'unknown',
        };
        
        // Try to get last run info
        if (CRON_RUNS_DIR && fs.existsSync(CRON_RUNS_DIR)) {
          try {
            const runFiles = fs.readdirSync(CRON_RUNS_DIR)
              .filter(f => f.startsWith(j.id + '_') && f.endsWith('.json'))
              .sort()
              .reverse();
            
            if (runFiles.length > 0) {
              const lastRunFile = path.join(CRON_RUNS_DIR, runFiles[0]);
              const runData = JSON.parse(fs.readFileSync(lastRunFile, 'utf8'));
              jobInfo.lastRun = runData.startedAt || runData.timestamp;
              jobInfo.lastStatus = runData.status || (runData.error ? 'error' : 'ok');
            }
          } catch (e) { /* skip */ }
        }
        
        return jobInfo;
      });

      stats.cron = {
        total: jobs.length,
        enabled: jobs.filter(j => j.enabled !== false).length,
        jobs: jobsWithRuns,
      };
    } else {
      stats.cron = { total: 0, enabled: 0, jobs: [] };
    }
  } catch (e) {
    stats.cron = { error: e.message };
  }

  // Sessions
  try {
    if (fs.existsSync(SESSIONS_DIR)) {
      const sessionFiles = fs.readdirSync(SESSIONS_DIR)
        .filter(f => f.endsWith('.json'));
      
      // Count sessions active in last 24h
      const oneDayAgo = Date.now() - 24 * 60 * 60 * 1000;
      let recentCount = 0;
      const recentSessions = [];
      
      for (const file of sessionFiles.slice(0, 100)) {
        try {
          const filePath = path.join(SESSIONS_DIR, file);
          const stat = fs.statSync(filePath);
          if (stat.mtimeMs > oneDayAgo) {
            recentCount++;
            if (recentSessions.length < 20) {
              const sessionData = JSON.parse(fs.readFileSync(filePath, 'utf8'));
              recentSessions.push({
                key: sessionData.key || file.replace('.json', ''),
                label: sessionData.label,
                lastActivity: new Date(stat.mtimeMs).toISOString(),
              });
            }
          }
        } catch (e) { /* skip */ }
      }

      stats.sessions = {
        total: sessionFiles.length,
        recent24h: recentCount,
        active: recentCount,
        list: recentSessions.sort((a, b) => new Date(b.lastActivity) - new Date(a.lastActivity)),
      };
    } else {
      stats.sessions = { total: 0, recent24h: 0, active: 0, list: [] };
    }
  } catch (e) {
    stats.sessions = { error: e.message };
  }

  // System logs (recent entries)
  try {
    const logFiles = ['gateway.log', 'gateway.err.log'];
    const entries = [];
    
    for (const logFile of logFiles) {
      const logPath = path.join(LOGS_DIR, logFile);
      if (fs.existsSync(logPath)) {
        try {
          // Read last 50 lines
          const content = execSync(`tail -50 "${logPath}" 2>/dev/null || true`, { encoding: 'utf8' });
          const lines = content.trim().split('\n').filter(l => l.trim());
          
          for (const line of lines) {
            let level = 'INFO';
            if (/\b(error|fatal|fail)\b/i.test(line)) level = 'ERROR';
            else if (/\bwarn/i.test(line)) level = 'WARN';
            else if (/\b(ok|success|ready|started)\b/i.test(line)) level = 'OK';
            
            // Try to extract timestamp
            const tsMatch = line.match(/^(\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2})/);
            const time = tsMatch ? tsMatch[1] : new Date().toISOString();
            
            entries.push({
              time,
              level,
              category: logFile.includes('err') ? 'error' : 'gateway',
              message: line.replace(/^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}[^\s]*\s*/, '').substring(0, 200),
            });
          }
        } catch (e) { /* skip */ }
      }
    }
    
    // Sort by time descending and limit
    entries.sort((a, b) => new Date(b.time) - new Date(a.time));
    stats.systemLog = {
      entries: entries.slice(0, 50),
    };
  } catch (e) {
    stats.systemLog = { error: e.message, entries: [] };
  }

  // Today's activity (from session logs or activity endpoint)
  try {
    const today = new Date().toISOString().split('T')[0];
    const activities = [];
    
    // Check sessions for today's activity
    if (stats.sessions?.list) {
      for (const session of stats.sessions.list.slice(0, 10)) {
        activities.push({
          icon: '💬',
          text: `Session: ${session.label || session.key}`,
          source: 'sessions',
          time: session.lastActivity,
        });
      }
    }
    
    // Check cron runs for today
    if (CRON_RUNS_DIR && fs.existsSync(CRON_RUNS_DIR)) {
      try {
        const todayRuns = fs.readdirSync(CRON_RUNS_DIR)
          .filter(f => f.includes(today) && f.endsWith('.json'))
          .slice(0, 10);
        
        for (const runFile of todayRuns) {
          try {
            const runData = JSON.parse(fs.readFileSync(path.join(CRON_RUNS_DIR, runFile), 'utf8'));
            activities.push({
              icon: '⏰',
              text: `Cron: ${runData.jobName || runFile.split('_')[0]}`,
              source: 'cron',
              status: runData.error ? 'error' : 'ok',
              time: runData.startedAt || runData.timestamp,
            });
          } catch (e) { /* skip */ }
        }
      } catch (e) { /* skip */ }
    }
    
    // Sort by time
    activities.sort((a, b) => new Date(b.time || 0) - new Date(a.time || 0));
    
    stats.today = {
      date: today,
      activities: activities.slice(0, 20),
    };
  } catch (e) {
    stats.today = { date: new Date().toISOString().split('T')[0], activities: [], error: e.message };
  }

  return stats;
}

module.exports = { collectOpenClawStats };
