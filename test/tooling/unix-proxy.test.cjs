const assert=require('node:assert/strict');
const {test}=require('node:test');
const {readFileSync}=require('node:fs');
const path=require('node:path');
const yaml=require('js-yaml');
const root=path.resolve(__dirname,'../..');
const render=env=>require(path.join(root,'scripts/render-unix-proxy.cjs')).renderUnixProxy(env);
const valid={PORTAL_PUBLIC_ORIGIN:'https://portal-ci.example.test',PORTAL_PROXY_RESPONSE_MODE:'app'};
test('Unix proxy has only a filesystem listener and no TCP backend',()=>{
  const config=render(valid);
  assert.match(config,/listen unix:\/run\/portal\/portal.sock;/);
  assert.equal([...config.matchAll(/\blisten\s+([^;]+);/g)].length,1);
  assert.doesNotMatch(config,/listen\s+(?:80|8088|127\.|\[::)/);
  assert.match(config,/proxy_pass http:\/\/portal_application;/);
  assert.match(config,/keepalive 8;/);
  assert.match(config,/proxy_request_buffering off;/);
});
test('Unix proxy accepts the v1.104.7 localhost Host rewrite only behind canonical forwarded-host validation',()=>{
  const config=render(valid);
  assert.match(config,/"localhost" 1;/);
  assert.match(config,/"portal-ci.example.test" 1;/);
  assert.match(config,/set_real_ip_from unix:;/);
  assert.match(config,/if \(\$portal_forwarded_host = 0\) \{ return 403; \}/);
  assert.match(config,/if \(\$portal_https = 0\) \{ return 403; \}/);
  assert.match(config,/if \(\$portal_client_valid = 0\) \{ return 403; \}/);
  assert.match(config,/if \(\$portal_no_funnel = 0\) \{ return 403; \}/);
  assert.match(config,/proxy_set_header Host "portal-ci.example.test";/);
  assert.doesNotMatch(config,/set_real_ip_from (?:127\.|0\.0\.0|100\.)/);
});
test('Unix placeholder preserves HTTPS availability before NestJS deployment',()=>{
  const config=render({...valid,PORTAL_PROXY_RESPONSE_MODE:'placeholder'});
  assert.match(config,/return 200 'portal nginx is running';/);
  assert.doesNotMatch(config,/app:3000|proxy_pass/);
  assert.match(config,/location = \/__portal_proxy_health \{ return 204; \}/);
});
for(const mode of [undefined,'','proxy','app; listen 80'])test(`invalid Unix response mode ${String(mode)}`,()=>{
  assert.throws(()=>render({...valid,PORTAL_PROXY_RESPONSE_MODE:mode}),/PORTAL_PROXY_RESPONSE_MODE/);
});
test('Unix origin remains configuration based for later domain changes',()=>{
  const config=render({...valid,PORTAL_PUBLIC_ORIGIN:'https://future.example.test'});
  assert.match(config,/proxy_set_header Host "future.example.test";/);
  assert.doesNotMatch(config,/portal-ci.example.test/);
});
test('complete Unix Compose removes publishing without unsupported reset tags and preserves dependency definitions',()=>{
  const config=yaml.load(readFileSync(path.join(root,'deploy/ds920/compose.unix.yml'),'utf8'));
  const original=yaml.load(readFileSync(path.join(root,'deploy/ds920/compose.infrastructure.yml'),'utf8'));
  assert.equal(config.services.nginx.ports,undefined);
  assert.equal(config.services.nginx.network_mode,undefined);
  assert.equal(config.networks,undefined);
  assert.equal(config.volumes,undefined);
  assert.deepEqual(config.services.couchdb,original.services.couchdb);
  assert.deepEqual(config.services.redis,original.services.redis);
  assert.equal(config.services.nginx.container_name,'portal-nginx');
  assert.deepEqual(config.services.nginx.volumes.slice(0,original.services.nginx.volumes.length),original.services.nginx.volumes);
  const socket=config.services.nginx.volumes[original.services.nginx.volumes.length];
  assert.equal(socket.type,'bind');assert.equal(socket.target,'/run/portal');
  assert.equal(socket.bind.create_host_path,false);assert.equal(socket.read_only,false);
  assert.equal(config.services.nginx.healthcheck.test[1],'/usr/local/bin/portal-socket');
});
