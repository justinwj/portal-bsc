import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {mkdtemp, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import {promisify} from 'node:util';
import {before, after, describe, it} from 'node:test';

const exec = promisify(execFile);
describe('restricted inherited Nginx Unix listener on real Linux containers', {concurrency:false, timeout:120000}, () => {
  const name = `portal-socket-${randomUUID()}`, image = 'portal-nginx-socket:ci';
  let config:string;
  const docker = (args:string[]) => exec('docker', args, {timeout:45000, maxBuffer:1024*1024});
  before(async()=>{
    const dir=await mkdtemp(join(tmpdir(),'portal-socket-'));
    config=join(dir,'nginx.conf');
    await writeFile(config,require('../../scripts/render-unix-proxy.cjs').renderUnixProxy({
      PORTAL_PUBLIC_ORIGIN:'https://portal-ci.example.test',PORTAL_PROXY_RESPONSE_MODE:'placeholder'}));
    await docker(['run','-d','--name',name,'-e','PORTAL_SOCKET_GID=0','--mount',`type=bind,src=${config},dst=/etc/nginx/nginx.conf,readonly`,
      '--entrypoint','sh',image,'-c','if [ ! -d /run/portal ]; then mkdir -m 750 /run/portal; fi; exec /usr/local/bin/portal-socket']);
    const deadline=Date.now()+15000;
    while(true){try{await docker(['exec',name,'portal-socket','--check']);break;}catch(error){if(Date.now()>deadline)throw error;await new Promise(r=>setTimeout(r,100));}}
  });
  after(async()=>{await docker(['rm','-f',name]).catch(()=>undefined);});
  it('creates a root-owned 0660 socket inside 0750 directory; binary stays Nginx 1.30.5',async()=>{
    assert.equal((await docker(['exec',name,'stat','-c','%a:%u:%g','/run/portal/portal.sock'])).stdout.trim(),'660:0:0');
    assert.equal((await docker(['exec',name,'stat','-c','%a','/run/portal'])).stdout.trim(),'750');
    assert.match((await docker(['exec',name,'nginx','-v'])).stderr,/nginx\/1\.30\.5/);
  });
  it('has no published TCP port or in-container TCP listener',async()=>{
    const info=JSON.parse((await docker(['inspect',name])).stdout)[0];
    assert.deepEqual(info.HostConfig.PortBindings,{});
    const sockets=(await docker(['exec',name,'cat','/proc/net/tcp','/proc/net/tcp6'])).stdout;
    assert.equal(sockets.trim().split('\n').filter(line=>line.trim()&&!line.includes('local_address')).length,0);
  });
  it('unprivileged unrelated UID cannot reach the socket; verified group can',async()=>{
    await assert.rejects(docker(['exec','--user','65534:65534',name,'curl','--fail','--max-time','3','--unix-socket','/run/portal/portal.sock','http://localhost/__portal_proxy_health']));
    await docker(['exec','--user','65534:0',name,'portal-socket','--check']);
  });
  it('accepts version-specific Serve metadata, strips insecure/incomplete requests',async()=>{
    const fields={'Host':'localhost','X-Forwarded-Host':'portal-ci.example.test','X-Forwarded-Proto':'https','X-Forwarded-For':'100.100.100.1'};
    const flags=(values:Record<string,string>)=>Object.entries(values).flatMap(([key,value])=>['-H',`${key}: ${value}`]);
    const headers=flags(fields);
    const result=await docker(['exec',name,'curl','--fail','--unix-socket','/run/portal/portal.sock',...headers,'http://localhost/']);
    assert.equal(result.stdout,'portal nginx is running');
    for(const extra of [null,{'X-Forwarded-For':'invalid'},{'X-Forwarded-For':'192.0.2.1, 192.0.2.2'},{'X-Forwarded-Proto':'http'},{Host:'wrong.example.test'},{'X-Forwarded-Host':'wrong.example.test'},{'Tailscale-Funnel-Request':'?1'}]){
      const args=extra?flags({...fields,...extra}):[];
      const reply=await docker(['exec',name,'curl','-s','-o','/dev/null','-w','%{http_code}','--unix-socket','/run/portal/portal.sock',...args,'http://localhost/login']);
      assert.equal(reply.stdout,'403',JSON.stringify(extra));
    }
  });
  it('refuses a second launcher without replacing the active listener',async()=>{
    await assert.rejects(docker(['exec',name,'portal-socket']),/listener already active/);
    await docker(['exec',name,'portal-socket','--check']);
  });
  it('retains the restricted listener through Nginx reload',async()=>{
    await docker(['exec',name,'nginx','-s','reload']);await docker(['exec',name,'portal-socket','--check']);
    assert.equal((await docker(['exec',name,'stat','-c','%a','/run/portal/portal.sock'])).stdout.trim(),'660');
  });
  for(const [label,setup] of [
    ['missing directory','true'],['world-accessible directory','mkdir -m 777 /run/portal'],
    ['symlink directory','mkdir -m 750 /private; ln -s /private /run/portal'],
    ['regular socket-path file','mkdir -m 750 /run/portal; echo sentinel >/run/portal/portal.sock'],
    ['symlink socket path','mkdir -m 750 /run/portal; ln -s /etc/passwd /run/portal/portal.sock'],
    ['missing group configuration','mkdir -m 750 /run/portal; unset PORTAL_SOCKET_GID'],
  ])it(`fails closed with ${label}`,async()=>{
    await assert.rejects(docker(['run','--rm','-e','PORTAL_SOCKET_GID=0','--entrypoint','sh',image,'-c',`${setup}; exec /usr/local/bin/portal-socket`]));
  });
  it('recovers a stale socket after SIGKILL, without changing mode',async()=>{
    await docker(['kill','--signal','KILL',name]);await docker(['start',name]);
    const deadline=Date.now()+15000;
    while(true){try{await docker(['exec',name,'portal-socket','--check']);break;}catch(error){if(Date.now()>deadline)throw error;await new Promise(r=>setTimeout(r,100));}}
    assert.equal((await docker(['exec',name,'stat','-c','%a','/run/portal/portal.sock'])).stdout.trim(),'660');
  });
});
