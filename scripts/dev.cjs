const fs = require('node:fs');
const path = require('node:path');
const net = require('node:net');
const crypto = require('node:crypto');
const { fork } = require('node:child_process');
const ts = require('typescript');
const { killTree } = require('./process-tree.cjs');

const root = process.cwd();
let configPath = path.join(root, 'tsconfig.build.json'), inspectPort;
for (let i = 2; i < process.argv.length; i++) {
  const arg = process.argv[i];
  if (arg === '--project' && process.argv[i + 1]) configPath = path.resolve(process.argv[++i]);
  else if (arg === '--inspect') inspectPort ??= 9229;
  else if (/^--inspect=\d+$/.test(arg)) inspectPort = Number(arg.split('=')[1]);
  else throw Error(`Invalid development runner argument: ${arg}; --inspect accepts only a loopback port number`);
}
if (inspectPort !== undefined && (!Number.isInteger(inspectPort) || inspectPort < 1 || inspectPort > 65535)) {
  throw Error('Inspector port must be between 1 and 65535');
}
const formatHost = { getCanonicalFileName: f => f, getCurrentDirectory: () => root, getNewLine: () => '\n' };
const diagnosticText = diagnostics => ts.formatDiagnosticsWithColorAndContext(diagnostics, formatHost);
const sourceConfig = ts.readConfigFile(configPath, ts.sys.readFile);
if (sourceConfig.error) throw Error(diagnosticText([sourceConfig.error]));
const parsed = ts.parseJsonConfigFileContent(sourceConfig.config, ts.sys, path.dirname(configPath));
if (parsed.errors.length) throw Error(diagnosticText(parsed.errors));
const tempParent = path.join(root, 'tmp');
fs.mkdirSync(tempParent, { recursive: true });
const runRoot = fs.mkdtempSync(path.join(tempParent, 'portal-dev-'));
let generation = 0, desired, draining, current, watcher, stopping = false;
const snapshots = new Set();
const event = (name, details = {}) => console.log('[portal-dev] ' + JSON.stringify({ event: name, ...details }));

function removeSnapshot(directory) {
  if (path.dirname(directory) !== runRoot) throw Error('Refusing cleanup outside the owned build root');
  fs.rmSync(directory, { recursive: true, force: true });
  snapshots.delete(directory);
}
function prune() {
  for (const directory of snapshots) if (directory !== current?.snapshot && directory !== desired?.snapshot) removeSnapshot(directory);
}
async function stopApplication() {
  const old = current;
  if (!old) return;
  // Runtime failure, recompilation and shutdown share a single termination.
  old.termination ??= (async () => {
    old.expectedExit = true;
    await killTree(old.child.pid);
    let timer;
    try {
      await Promise.race([old.closed, new Promise(resolve => { timer = setTimeout(resolve, 1500); })]);
      if (!old.exited) { await killTree(old.child.pid, 'SIGKILL'); await old.closed; }
      // Leader exit alone does not prove that every POSIX descendant exited.
      if (process.platform !== 'win32') await killTree(old.child.pid, 'SIGKILL');
    } finally { clearTimeout(timer); }
    event('stopped', { pid: old.appPid, generation: old.generation });
    if (current === old) current = undefined;
  })();
  await old.termination;
}
async function inspectorAvailable() {
  if (inspectPort === undefined) return;
  const server = net.createServer();
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(inspectPort, '127.0.0.1', resolve); });
  await new Promise(resolve => server.close(resolve));
}
function launch(build) {
  const entry = path.join(build.snapshot, 'main.js');
  if (!fs.existsSync(entry)) throw Error(`Compiled entrypoint is missing: ${entry}`);
  const execArgv = ['--enable-source-maps', ...(inspectPort === undefined ? [] : [`--inspect=127.0.0.1:${inspectPort}`])];
  // Keep ownership outside the debugged process: a debugger pause must never
  // prevent cleanup after the watcher disappears.
  const child = fork(path.join(__dirname, 'dev-child.cjs'), [entry, runRoot, JSON.stringify(execArgv)], {
    cwd: root, execArgv: [], detached: process.platform !== 'win32', windowsHide: true,
    stdio: ['ignore', 'inherit', 'inherit', 'ipc'],
  });
  const record = { ...build, child, exited: false, expectedExit: false };
  record.closed = new Promise(resolve => child.once('close', (code, signal) => {
    record.exited = true;
    if (!record.expectedExit) {
      event('runtime-exit', { code, signal, pid: record.appPid, generation: build.generation });
      // POSIX descendants retain their process group even if the leader exited.
      if (process.platform !== 'win32') killTree(child.pid, 'SIGKILL').catch(console.error);
    }
    resolve();
  }));
  current = record;
  child.on('error', error => event('startup-error', { message: error.message }));
  child.on('message', message => {
    if (message.event === 'application-started') {
      record.appPid = message.pid;
      event('started', { pid: message.pid, ownerPid: child.pid, generation: build.generation, entry, inspectPort });
    } else if (message.event === 'runtime-exit') {
      event('runtime-exit', { code: message.code, signal: message.signal, pid: record.appPid, generation: build.generation });
      stopApplication().catch(error => shutdown(1, error));
    }
  });
}
function queue(build) {
  desired = build;
  if (draining) return;
  draining = (async () => {
    while (desired && !stopping) {
      const next = desired; desired = undefined;
      // Repeated filesystem notifications for identical emitted bytes do not
      // restart the application. Generations arriving during termination replace
      // the pending build; only the latest complete one can start.
      if (!next.error && current && !current.exited && current.hash === next.hash) { prune(); continue; }
      await stopApplication();
      if (desired || stopping) { prune(); continue; }
      if (!next.error) {
        try { await inspectorAvailable(); if (!desired && !stopping) launch(next); }
        catch (error) { event('startup-error', { message: error.message, generation: next.generation }); }
      }
      prune();
    }
  })().catch(error => { setImmediate(() => shutdown(1, error)); }).finally(() => {
    draining = undefined;
    event('idle', { generation });
    if (desired && !stopping) queue(desired);
  });
}
async function shutdown(code = 0, error) {
  if (stopping) return;
  stopping = true;
  if (error) console.error(error.stack || error);
  watcher?.close();
  desired = undefined;
  try {
    // A drain already terminating the old process must finish before cleanup.
    if (draining) await draining;
    await stopApplication();
    if (path.dirname(runRoot) !== tempParent || !path.basename(runRoot).startsWith('portal-dev-')) throw Error('Unsafe cleanup target');
    fs.rmSync(runRoot, { recursive: true, force: true });
  } catch (failure) { console.error(failure.stack || failure); code = 1; }
  event('shutdown', { code });
  process.exit(code);
}
process.once('SIGINT', () => shutdown());
process.once('SIGTERM', () => shutdown());
process.on('message', message => { if (message.command === 'stop') shutdown(); });
process.once('disconnect', () => shutdown());

const host = ts.createWatchCompilerHost(configPath, { noEmit: true, incremental: false }, ts.sys,
  ts.createSemanticDiagnosticsBuilderProgram,
  diagnostic => console.error(diagnosticText([diagnostic])), () => {});
host.afterProgramCreate = builder => {
  if (stopping) return;
  const version = ++generation;
  event('compiling', { generation: version });
  const program = builder.getProgram();
  const diagnostics = ts.getPreEmitDiagnostics(program);
  if (diagnostics.some(d => d.category === ts.DiagnosticCategory.Error)) {
    console.error(diagnosticText(diagnostics));
    event('compile-error', { generation: version });
    queue({ generation: version, error: true });
    return;
  }
  const snapshot = path.join(runRoot, `build-${version}`);
  snapshots.add(snapshot);
  const complete = ts.createProgram({ rootNames: program.getRootFileNames(), oldProgram: program,
    options: { ...program.getCompilerOptions(), noEmit: false, noEmitOnError: true, incremental: false, outDir: snapshot } });
  const digest = crypto.createHash('sha256');
  const emitted = complete.emit(undefined, (name, text) => {
    const relative = path.relative(snapshot, name);
    if (relative.startsWith('..') || path.isAbsolute(relative)) throw Error('Compiler output escaped its private snapshot');
    fs.mkdirSync(path.dirname(name), { recursive: true }); fs.writeFileSync(name, text);
    digest.update(relative); digest.update(text);
  });
  if (emitted.emitSkipped || emitted.diagnostics.some(d => d.category === ts.DiagnosticCategory.Error)) {
    console.error(diagnosticText(emitted.diagnostics));
    event('compile-error', { generation: version }); queue({ generation: version, error: true });
  } else {
    event('compiled', { generation: version });
    queue({ generation: version, snapshot, hash: digest.digest('hex') });
  }
};
watcher = ts.createWatchProgram(host);
