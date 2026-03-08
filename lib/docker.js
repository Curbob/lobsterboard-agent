/**
 * Docker stats collection (optional)
 */

const { exec } = require('child_process');
const { promisify } = require('util');

const execAsync = promisify(exec);

async function collectDockerStats() {
  try {
    // Check if Docker is available
    await execAsync('docker info', { timeout: 5000 });
  } catch (e) {
    return { available: false };
  }

  try {
    // Get container list
    const { stdout } = await execAsync(
      'docker ps --format "{{.ID}}|{{.Names}}|{{.Status}}|{{.Image}}"',
      { timeout: 10000 }
    );

    const containers = stdout.trim().split('\n').filter(Boolean).map(line => {
      const [id, name, status, image] = line.split('|');
      return {
        id: id?.slice(0, 12),
        name,
        status,
        image,
        running: status?.toLowerCase().includes('up'),
      };
    });

    // Get counts
    const { stdout: allCount } = await execAsync('docker ps -aq | wc -l', { timeout: 5000 });
    const { stdout: runningCount } = await execAsync('docker ps -q | wc -l', { timeout: 5000 });

    return {
      available: true,
      total: parseInt(allCount.trim(), 10) || 0,
      running: parseInt(runningCount.trim(), 10) || 0,
      containers: containers.slice(0, 20), // Limit to 20
    };
  } catch (e) {
    return { available: true, error: e.message };
  }
}

module.exports = { collectDockerStats };
