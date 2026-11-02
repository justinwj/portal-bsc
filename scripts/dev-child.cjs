const { spawn } = require('node:child_process');
const { ownerGone } = require('./process-tree.cjs');

// This guard is never debugged. Its PID stays alive until the watcher terminates
// the tree, even if the application pauses in a debugger or crashes.
const [entry, runRoot, argumentsJson] = process.argv.slice(2);
const cleanup = () => ownerGone(runRoot);
process.once('disconnect', cleanup);
const application = spawn(process.execPath, [...JSON.parse(argumentsJson), entry], {
  cwd: process.cwd(), windowsHide: true, stdio: ['ignore', 'inherit', 'inherit'],
});
application.once('spawn', () => process.send?.({ event: 'application-started', pid: application.pid }));
application.once('error', error => console.error(`Application startup failed: ${error.stack || error}`));
application.once('close', (code, signal) => {
  if (process.connected) process.send({ event: 'runtime-exit', code, signal }, () => {});
  else cleanup();
  setTimeout(cleanup, 3000);
});
