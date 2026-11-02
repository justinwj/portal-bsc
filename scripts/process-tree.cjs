const { execFile, execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

function killTree(pid, signal = 'SIGTERM') {
  if (process.platform === 'win32') {
    return new Promise((resolve, reject) => execFile('taskkill', ['/PID', String(pid), '/T', '/F'],
      { windowsHide: true }, error => {
        if (error) {
          try { process.kill(pid, 0); } catch (probe) { if (probe.code === 'ESRCH') return resolve(); }
          return reject(error);
        }
        resolve();
      }));
  }
  try { process.kill(-pid, signal); } catch (error) { if (error.code !== 'ESRCH') throw error; }
  return Promise.resolve();
}

// The undebugged ownership guard calls this if its IPC owner disappears, including a
// forced IDE Stop/TerminateProcess that cannot run the watcher's signal handlers.
function ownerGone(runRoot) {
  // Only the owning watcher's private snapshot root may be removed here.
  if (runRoot && path.dirname(runRoot) === path.join(process.cwd(), 'tmp')
      && path.basename(runRoot).startsWith('portal-dev-')) {
    try { fs.rmSync(runRoot, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 }); }
    catch (error) { console.error(`Could not remove development snapshots: ${error.message}`); }
  }
  if (process.platform === 'win32') {
    try { execFileSync('taskkill', ['/PID', String(process.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' }); }
    finally { process.exit(1); }
  }
  process.kill(-process.pid, 'SIGKILL');
}
module.exports = { killTree, ownerGone };
