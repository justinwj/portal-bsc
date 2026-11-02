// Test-only preload for deterministic I/O failures while reading actual fixture files.
// Production never imports this module. Core routes, services, guards and middleware remain real.
const fs = require('node:fs');
const counts = new Map();
function fail(fd, source) {
  let name;
  try { name = fs.readlinkSync(`/proc/self/fd/${fd}`); } catch { return false; }
  if (name.endsWith('/initial-error.pdf')) return true;
  if (!name.endsWith('/late-error.pdf')) return false;
  const key = `${source}:${fd}`;
  const count = (counts.get(key) ?? 0) + 1;
  counts.set(key, count);
  return count > 1;
}
function error() {
  console.error('Injected test filesystem EIO');
  return Object.assign(new Error('Injected test filesystem EIO'), { code: 'EIO' });
}
const read = fs.read;
fs.read = function (...args) {
  if (fail(args[0], 'callback')) return setImmediate(() => args.at(-1)(error()));
  return read.apply(this, args);
};
const open = fs.promises.open;
fs.promises.open = async function (...args) {
  const handle = await open.apply(this, args);
  const originalRead = handle.read;
  handle.read = function (...values) {
    if (fail(this.fd, 'promise')) return Promise.reject(error());
    return originalRead.apply(this, values);
  };
  return handle;
};
