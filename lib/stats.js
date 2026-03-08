/**
 * System stats collection using systeminformation
 */

const si = require('systeminformation');
const os = require('os');

async function collectStats() {
  const [cpu, mem, fsSize, networkStats, osInfo, currentLoad] = await Promise.all([
    si.cpu(),
    si.mem(),
    si.fsSize(),
    si.networkStats(),
    si.osInfo(),
    si.currentLoad(),
  ]);

  // Calculate network totals
  let netRx = 0, netTx = 0;
  for (const iface of networkStats) {
    netRx += iface.rx_sec || 0;
    netTx += iface.tx_sec || 0;
  }

  // Get primary disk (largest or root)
  const primaryDisk = fsSize.reduce((best, disk) => {
    if (!best || disk.size > best.size) return disk;
    return best;
  }, null);

  return {
    hostname: os.hostname(),
    platform: osInfo.platform,
    distro: osInfo.distro,
    release: osInfo.release,
    uptime: os.uptime(),
    
    cpu: {
      model: cpu.brand,
      cores: cpu.cores,
      speed: cpu.speed,
      usage: Math.round(currentLoad.currentLoad * 10) / 10,
    },
    
    memory: {
      total: mem.total,
      used: mem.used,
      free: mem.free,
      available: mem.available,
      percent: Math.round((mem.used / mem.total) * 1000) / 10,
    },
    
    disk: primaryDisk ? {
      mount: primaryDisk.mount,
      type: primaryDisk.type,
      total: primaryDisk.size,
      used: primaryDisk.used,
      free: primaryDisk.available,
      percent: Math.round(primaryDisk.use * 10) / 10,
    } : null,
    
    network: {
      rxSec: Math.round(netRx),
      txSec: Math.round(netTx),
    },
    
    load: {
      avg1: os.loadavg()[0],
      avg5: os.loadavg()[1],
      avg15: os.loadavg()[2],
    },
  };
}

module.exports = { collectStats };
