const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const net=require('node:net');
const {describe,it}=require('node:test');
const {MAIN,alive,until,port,assertPortFree,project,start,response}=require('./support.cjs');

describe('compilation-aware development lifecycle', {concurrency:false,timeout:180000},()=>{
  it('launches only after a completed initial compilation',async t=>{
    const fixture=await project(t), appPort=await port(), runner=start(t,fixture,{port:appPort});
    const ready=await runner.wait(e=>e.event==='ready');
    assert.equal(ready.value,'one');
    assert.ok(runner.records.findIndex(e=>e.event==='compiled')<runner.records.findIndex(e=>e.event==='started'));
    assert.equal((await response(appPort)).pid,ready.pid);
  });
  it('restarts exactly once after a valid change, after terminating the old application',async t=>{
    const fixture=await project(t), appPort=await port(), runner=start(t,fixture,{port:appPort});
    const first=await runner.wait(e=>e.event==='ready');
    await fs.writeFile(fixture.value,"export const value: string = 'two';");
    const second=await runner.wait(e=>e.event==='ready'&&e.value==='two');
    assert.notEqual(first.pid,second.pid);
    assert.equal(alive(first.pid),false);
    assert.equal((await response(appPort)).value,'two');
    const started=runner.records.filter(e=>e.event==='started');
    assert.equal(started.length,2);
    assert.ok(started.every(e=>!e.previousAlive));
    await runner.stop();
    assert.equal(runner.records.filter(e=>e.event==='started').length,2);
  });
  it('stops on type errors without launching partial output and recovers automatically',async t=>{
    const fixture=await project(t), appPort=await port(), runner=start(t,fixture,{port:appPort});
    const first=await runner.wait(e=>e.event==='ready');
    await fs.writeFile(fixture.value,'export const value: string = 123;');
    const error=await runner.wait(e=>e.event==='compile-error');
    await runner.wait(e=>e.event==='idle'&&e.generation>=error.generation);
    assert.equal(alive(first.pid),false);
    await assertPortFree(appPort);
    assert.equal(runner.records.filter(e=>e.event==='started').length,1);
    assert.match(runner.output,/TS2322/);
    await fs.writeFile(fixture.value,"export const value: string = 'recovered';");
    await runner.wait(e=>e.event==='ready'&&e.value==='recovered');
    assert.equal((await response(appPort)).value,'recovered');
  });
  it('does not start initially invalid source and starts after correction',async t=>{
    const fixture=await project(t,true), appPort=await port(), runner=start(t,fixture,{port:appPort});
    const error=await runner.wait(e=>e.event==='compile-error');
    await runner.wait(e=>e.event==='idle'&&e.generation>=error.generation);
    assert.equal(runner.records.some(e=>e.event==='started'),false);
    await fs.writeFile(fixture.value,"export const value: string = 'fixed';");
    await runner.wait(e=>e.event==='ready'&&e.value==='fixed');
  });
  it('coalesces rapid saves without overlapping processes and serves the final version',async t=>{
    const fixture=await project(t), appPort=await port(), runner=start(t,fixture,{port:appPort});
    await runner.wait(e=>e.event==='ready');
    for(let i=0;i<6;i++)await fs.writeFile(fixture.value,`export const value: string = 'rapid-${i}';`);
    await runner.wait(e=>e.event==='ready'&&e.value==='rapid-5');
    assert.equal((await response(appPort)).value,'rapid-5');
    assert.ok(runner.records.filter(e=>e.event==='started').every(e=>!e.previousAlive));
  });
  it('shutdown terminates the application tree and releases its ports',async t=>{
    const fixture=await project(t), appPort=await port(), treePort=await port();
    const runner=start(t,fixture,{port:appPort,env:{TREE_PORT:String(treePort)}});
    const ready=await runner.wait(e=>e.event==='ready'), tree=await runner.wait(e=>e.event==='tree-ready');
    await runner.stop();
    await until(()=>{assert.equal(alive(ready.pid),false);assert.equal(alive(tree.pid),false);},'Owned processes remained alive');
    await assertPortFree(appPort);await assertPortFree(treePort);
  });
  it('forced watcher termination also cleans up the owned application tree',async t=>{
    const fixture=await project(t), appPort=await port(), treePort=await port();
    const runner=start(t,fixture,{port:appPort,env:{TREE_PORT:String(treePort)}});
    const ready=await runner.wait(e=>e.event==='ready'), tree=await runner.wait(e=>e.event==='tree-ready');
    runner.child.kill('SIGKILL');await runner.exited;
    await until(()=>{assert.equal(alive(ready.pid),false);assert.equal(alive(tree.pid),false);},'Parent-death cleanup failed');
    await assertPortFree(appPort);await assertPortFree(treePort);
  });
  it('repeated start/stop cycles leave the application port reusable',async t=>{
    const fixture=await project(t), appPort=await port();
    for(let i=0;i<2;i++){
      const runner=start(t,fixture,{port:appPort});const ready=await runner.wait(e=>e.event==='ready');
      await runner.stop();assert.equal(alive(ready.pid),false);await assertPortFree(appPort);
    }
  });
  it('reports runtime crashes and recovers on a subsequent successful compilation',async t=>{
    const fixture=await project(t), appPort=await port();
    await fs.writeFile(fixture.main,"throw new Error('fixture-runtime-failure');\n"+MAIN);
    const runner=start(t,fixture,{port:appPort});await runner.wait(e=>e.event==='runtime-exit');
    assert.match(runner.output,/fixture-runtime-failure/);
    await fs.writeFile(fixture.main,MAIN);await runner.wait(e=>e.event==='ready');
    assert.equal((await response(appPort)).value,'one');
  });
});

async function inspector(value){return until(async()=>{
  const response=await fetch(`http://127.0.0.1:${value}/json/list`,{signal:AbortSignal.timeout(2000)});
  const list=await response.json();assert.equal(list.length,1);return list[0];
},'Inspector did not become ready');}
async function inspect(target){
  assert.equal(new URL(target.webSocketDebuggerUrl).hostname,'127.0.0.1');
  const ws=new WebSocket(target.webSocketDebuggerUrl), scripts=[],pending=new Map();let id=0;
  await new Promise((resolve,reject)=>{ws.addEventListener('open',resolve,{once:true});ws.addEventListener('error',reject,{once:true});});
  ws.addEventListener('message',event=>{const data=JSON.parse(event.data);if(data.method==='Debugger.scriptParsed')scripts.push(data.params);if(data.id){pending.get(data.id)?.(data);pending.delete(data.id);}});
  async function command(method,params={}){const n=++id;return new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('Inspector response timeout')),5000);pending.set(n,data=>{clearTimeout(timer);data.error?reject(Error(JSON.stringify(data.error))):resolve(data.result);});ws.send(JSON.stringify({id:n,method,params}));});}
  try{
    await command('Debugger.enable');
    const stack=await command('Runtime.evaluate',{expression:'globalThis.probeStack()',returnByValue:true});
    assert.match(stack.result.value,/src[\\/]main\.ts/);
    assert.ok(scripts.some(s=>s.url.endsWith('/main.js')&&s.sourceMapURL==='main.js.map'));
  }finally{ws.close();await new Promise(resolve=>ws.addEventListener('close',resolve,{once:true}));}
}
describe('loopback debugging and source maps',{concurrency:false,timeout:90000},()=>{
  it('attaches to the predictable loopback inspector with TypeScript maps across restarts',async t=>{
    const fixture=await project(t), appPort=await port(), debugPort=await port();
    const runner=start(t,fixture,{port:appPort,args:[`--inspect=${debugPort}`]});
    const ready=await runner.wait(e=>e.event==='ready');
    assert.ok(ready.execArgv.includes('--enable-source-maps'));
    assert.ok(ready.execArgv.includes(`--inspect=127.0.0.1:${debugPort}`));
    const first=await inspector(debugPort);await inspect(first);
    await fs.writeFile(fixture.value,"export const value: string = 'debug-two';");
    await runner.wait(e=>e.event==='ready'&&e.value==='debug-two');
    const second=await inspector(debugPort);assert.notEqual(second.id,first.id);await inspect(second);
    await runner.stop();await assertPortFree(debugPort);await assertPortFree(appPort);
  });
  it('rejects a public inspector host instead of opening a debug endpoint',async t=>{
    const fixture=await project(t), runner=start(t,fixture,{port:await port(),args:['--inspect=0.0.0.0:9229']});
    assert.notEqual(await runner.exited,0);assert.match(runner.output,/inspect|argument/i);
    assert.equal(runner.records.some(e=>e.event==='started'),false);
  });
  it('reports an occupied inspector port without launching an undebuggable application',async t=>{
    const fixture=await project(t), appPort=await port(), debugPort=await port();
    const server=net.createServer();await new Promise(resolve=>server.listen(debugPort,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>server.close(resolve)));
    const runner=start(t,fixture,{port:appPort,args:[`--inspect=${debugPort}`]});
    await runner.wait(e=>e.event==='startup-error');assert.equal(runner.records.some(e=>e.event==='started'),false);
    await runner.stop();await assertPortFree(appPort);
  });
});
