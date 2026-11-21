import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {mkdtemp, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import {promisify} from 'node:util';
import {describe, it} from 'node:test';

const exec = promisify(execFile), yaml = require('js-yaml');
const base = resolve('deploy/ds920/compose.unix.yml');
const app = resolve('deploy/ds920/compose.app.yml');
const historical = resolve('deploy/ds920/compose.infrastructure.yml');
// Synthetic values only; config parsing never starts these services or touches paths.
const env = {...process.env, COUCHDB_USER:'ci-only', COUCHDB_PASSWORD:'ci-only',
  PORTAL_NGINX_SOCKET_IMAGE:'portal-nginx-socket:ci', PORTAL_SOCKET_GID:'0',
  PORTAL_SOCKET_HOST_PATH:'/not-created/socket', PORTAL_APP_IMAGE:'portal-bsc:ci',
  PORTAL_APP_UID:'1001', PORTAL_APP_GID:'1001', SESSION_SECRET:'ci-only-session-secret',
  PORTAL_COUCHDB_URL:'http://couchdb:5984', PORTAL_REDIS_URL:'redis://redis:6379',
  NAS_FILES_HOST_PATH:'/not-created/legacy', PORTAL_UPLOADS_HOST_PATH:'/not-created/managed',
  PORTAL_UPLOADS_STORAGE_ID:'ci-only-storage', PORTAL_UPLOAD_MIN_FREE_BYTES:'1048576'};

async function normalized(files:string[]) {
  const result=await exec('docker',['compose','-p','portal',...files.flatMap(file=>['-f',file]),'config','--format','json'],{env,timeout:20000});
  return JSON.parse(result.stdout);
}
function unpublished(services:Record<string,any>) {
  for(const [name,service] of Object.entries(services)) {
    assert.equal(service.ports,undefined,`${name}: published host ports are forbidden`);
    assert.equal(service.network_mode,undefined,`${name}: host/alternate network mode is forbidden`);
  }
}

describe('effective DS920 production Compose isolation (no containers started)',{concurrency:false},()=>{
  for(const service of ['nginx','couchdb','redis'])it(`Unix base ${service} has no published ports`,async()=>{
    unpublished({[service]:(await normalized([base])).services[service]});
  });
  it('app overlay alone introduces no host publication',async()=>{
    unpublished((await normalized([app])).services);
  });
  it('approved Unix base plus app overlay has zero host publications for every service',async()=>{
    const config=await normalized([base,app]);
    assert.deepEqual(Object.keys(config.services).sort(),['app','couchdb','nginx','redis']);
    unpublished(config.services);
  });
  it('all four services retain only the existing default network and internal dependency URLs',async()=>{
    const config=await normalized([base,app]);
    assert.equal(config.name,'portal');assert.deepEqual(Object.keys(config.networks),['default']);
    assert.equal(config.networks.default.name,'portal_default');assert.equal(config.volumes,undefined);
    for(const service of Object.values(config.services) as any[])assert.deepEqual(Object.keys(service.networks),['default']);
    assert.equal(config.services.app.environment.COUCHDB_URL,'http://couchdb:5984');
    assert.equal(config.services.app.environment.REDIS_URL,'redis://redis:6379');
    for(const name of ['nginx','couchdb','redis'])assert.equal(config.services[name].container_name,`portal-${name}`);
  });
  it('removes only database publication while preserving normalized mounts, auth and Redis command',async()=>{
    const original=await normalized([historical]),config=await normalized([base]);
    for(const name of ['couchdb','redis']){
      const expected={...original.services[name]};delete expected.ports;
      assert.ok(JSON.stringify(config.services[name])===JSON.stringify(expected),`Preserve every ${name} field except ports`);
    }
    assert.deepEqual(config.services.nginx.volumes.slice(0,3),original.services.nginx.volumes);
  });
  it('rejects the historical publishing base combined with the app instead of blessing a merge',async()=>{
    const unsafe=await normalized([historical,app]);
    assert.throws(()=>unpublished(unsafe.services),/published host ports are forbidden/);
    assert.deepEqual(['nginx','couchdb','redis'].map(name=>unsafe.services[name].ports[0].published),['8088','5984','6379']);
  });
  for(const [name,host,target] of [['nginx',8088,80],['couchdb',5984,5984],['redis',6379,6379]] as const)
    it(`detects ${host} publication accidentally reintroduced by Compose merging`,async()=>{
      const directory=await mkdtemp(join(tmpdir(),'portal-port-guard-'));
      const override=join(directory,'unsafe.yml');
      await writeFile(override,yaml.dump({services:{[name]:{ports:[`127.0.0.1:${host}:${target}`]}}}));
      const unsafe=await normalized([base,app,override]);
      assert.throws(()=>unpublished(unsafe.services),new RegExp(`${name}: published host ports are forbidden`));
      assert.ok(unsafe.services[name].ports.some((port:any)=>port.published===String(host)));
    });
});
