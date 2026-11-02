const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const net = require('node:net');
const { fork } = require('node:child_process');
const { createInterface } = require('node:readline');
const ROOT = path.resolve(__dirname, '../..');
const RUNNER = path.join(ROOT, 'scripts/dev.cjs');

function alive(pid) { try { process.kill(pid, 0); return true; } catch (error) { if (error.code === 'ESRCH') return false; throw error; } }
async function until(operation, message, timeout = 10000) {
  const deadline = Date.now() + timeout;
  let last;
  while (Date.now() < deadline) {
    try { return await operation(); } catch (error) { last = error; }
    await new Promise(resolve => setTimeout(resolve, 25));
  }
  throw new Error(`${message}: ${last?.message}`);
}
async function port() {
  const server = net.createServer();
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const value = server.address().port;
  await new Promise(resolve => server.close(resolve));
  return value;
}
async function assertPortFree(value) {
  await until(async () => {
    const server = net.createServer();
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(value, '127.0.0.1', resolve); });
    await new Promise(resolve => server.close(resolve));
  }, `Port ${value} was not released`);
}
const MAIN = `declare const require: any, process: any;
import { value } from './value';
(globalThis as any).probeStack = () => new Error('mapped-stack').stack;
if (process.env.TREE_PORT) {
  const script = "const net=require('node:net');net.createServer().listen(Number(process.env.TREE_PORT),'127.0.0.1',()=>console.log('APP '+JSON.stringify({event:'tree-ready',pid:process.pid})));";
  require('node:child_process').spawn(process.execPath, ['-e', script], {stdio:['ignore','inherit','inherit']});
}
const server = require('node:http').createServer((_req: any, res: any) => res.end(JSON.stringify({pid:process.pid,value})));
server.listen(Number(process.env.APP_PORT), '127.0.0.1', () => console.log('APP '+JSON.stringify({event:'ready',pid:process.pid,value,execArgv:process.execArgv})));
`;
async function project(t, invalid = false) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'portal-tooling-test-'));
  await fs.mkdir(path.join(directory, 'src'));
  await fs.writeFile(path.join(directory, 'src/main.ts'), MAIN);
  await fs.writeFile(path.join(directory, 'src/value.ts'), invalid ? 'export const value: string = 1;' : "export const value: string = 'one';");
  await fs.writeFile(path.join(directory, 'tsconfig.json'), JSON.stringify({compilerOptions:{target:'ES2021',module:'CommonJS',types:[],strict:true,skipLibCheck:true,sourceMap:true},include:['src/**/*.ts']}));
  t.after(async () => {
    assert.equal(path.dirname(directory), path.resolve(os.tmpdir()));
    assert.ok(path.basename(directory).startsWith('portal-tooling-test-'));
    await fs.rm(directory, {recursive:true,force:true});
  });
  return { directory, main: path.join(directory, 'src/main.ts'), value: path.join(directory, 'src/value.ts') };
}
function start(t, fixture, options = {}) {
  const args = ['--project', 'tsconfig.json', ...(options.args || [])];
  const child = fork(RUNNER, args, {cwd:fixture.directory,execArgv:[],silent:true,windowsHide:true,
    env:{...process.env,NODE_OPTIONS:'',APP_PORT:String(options.port),...options.env}});
  const records = [], listeners = new Set();
  let closed = false, output = '', previousPid;
  const exited = new Promise(resolve => child.once('close', code => { closed = true; for (const listener of listeners) listener(); resolve(code); }));
  child.on('error', error => { output += error.stack; });
  for (const stream of [child.stdout, child.stderr]) createInterface({input:stream}).on('line', line => {
    output += line + '\n';
    if (line.startsWith('[portal-dev] ') || line.startsWith('APP ')) {
      const record = JSON.parse(line.slice(line.startsWith('APP ') ? 4 : 13));
      if (record.event === 'started') { record.previousAlive = previousPid ? alive(previousPid) : false; previousPid = record.pid; }
      records.push(record);
    }
    for (const listener of listeners) listener();
  });
  function wait(predicate, from = 0) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => finish(new Error(`Runner completion timeout:\n${output.slice(-3000)}`)), 25000);
      function finish(error, value) { clearTimeout(timer); listeners.delete(check); error ? reject(error) : resolve(value); }
      function check() {
        const record = records.slice(from).find(predicate);
        if (record) finish(null, record);
        else if (closed) finish(new Error(`Runner exited before expected event:\n${output.slice(-3000)}`));
      }
      listeners.add(check); check();
    });
  }
  async function stop() {
    if (!closed && child.connected) child.send({command:'stop'}, () => {});
    let timer;
    try { await Promise.race([exited, new Promise((_,reject) => { timer=setTimeout(()=>reject(new Error('Watcher failed to stop')),10000); })]); }
    finally { clearTimeout(timer); if (!closed) child.kill('SIGKILL'); }
  }
  t.after(stop);
  return {child, records, exited, wait, stop, get output(){return output;}};
}
async function response(value) { return (await fetch(`http://127.0.0.1:${value}`, {signal:AbortSignal.timeout(2000)})).json(); }
module.exports = {ROOT, MAIN, alive, until, port, assertPortFree, project, start, response};
