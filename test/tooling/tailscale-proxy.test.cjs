const assert = require('node:assert/strict');
const {test} = require('node:test');
const path = require('node:path');
const {spawnSync} = require('node:child_process');
const script = path.resolve(__dirname, '../../scripts/render-tailscale-proxy.cjs');
const valid = {PORTAL_PUBLIC_ORIGIN:'https://portal-ci.example.test',PORTAL_SERVE_PROXY_PEERS:'192.0.2.10'};
const render = env => require(script).renderTailscaleProxy(env);

test('Serve proxy renders one configured canonical origin and exact observed peers without new mounts', () => {
  const config = render(valid);
  assert.match(config,/Canonical Portal URL: https:\/\/portal-ci\.example\.test/);
  assert.match(config,/listen 80;/);
  assert.match(config,/set_real_ip_from 192\.0\.2\.10;/);
  assert.match(config,/real_ip_recursive off;/);
  assert.match(config,/geo \$realip_remote_addr \$portal_trusted_peer/);
  assert.match(config,/proxy_set_header X-Forwarded-For \$remote_addr;/);
  assert.match(config,/proxy_set_header Host "portal-ci\.example\.test";/);
  assert.match(config,/if \(\$portal_trusted_peer = 0\) \{ return 403; \}/);
  assert.match(config,/if \(\$portal_https = 0\) \{ return 403; \}/);
  assert.match(config,/if \(\$portal_host = 0\) \{ return 403; \}/);
  assert.match(config,/if \(\$portal_forwarded_host = 0\) \{ return 403; \}/);
  assert.match(config,/if \(\$portal_client_is_peer = 1\) \{ return 403; \}/);
  assert.match(config,/if \(\$portal_no_funnel = 0\) \{ return 403; \}/);
  assert.match(config,/keepalive 8;/);
  assert.match(config,/proxy_request_buffering off;/);
  assert.doesNotMatch(config,/\b(include|alias|root|pid)\s/);
});
test('canonical hostname can change without application changes, including a future non-ts.net domain', () => {
  const config = render({...valid,PORTAL_PUBLIC_ORIGIN:'https://future.example.test:8443/'});
  assert.match(config,/proxy_set_header Host "future\.example\.test:8443";/);
  assert.doesNotMatch(config,/portal-ci\.example\.test/);
});
test('exact IPv6 and multiple observed peers are supported without trusting a subnet', () => {
  const config = render({...valid,PORTAL_SERVE_PROXY_PEERS:'192.0.2.10,2001:db8::10'});
  assert.match(config,/set_real_ip_from 2001:db8::10;/);
  assert.doesNotMatch(config,/set_real_ip_from (0\.0\.0\.0|100\.64\.0\.0)\//);
});
for(const value of [undefined,'','http://portal-ci.example.test','https://user:password@portal-ci.example.test','https://portal-ci.example.test/path','https://portal-ci.example.test/?x=1','https://portal-ci.example.test/#x','https://127.0.0.1','https://portal-ci.example.test;evil',' https://portal-ci.example.test']){
  test(`rejects unsafe or incomplete canonical origin (${String(value).split(':')[0]})`,()=>{
    assert.throws(()=>render({...valid,PORTAL_PUBLIC_ORIGIN:value}),/PORTAL_PUBLIC_ORIGIN/);
  });
}
for(const value of [undefined,'','0.0.0.0/0','192.0.2.0/24','127.0.0.1;return 200','example.test','192.0.2.10,192.0.2.10','192.0.2.10,,2001:db8::10','fe80::1%eth0']){
  test(`rejects absent, broad or malformed proxy peers (${String(value).slice(0,18)})`,()=>{
    assert.throws(()=>render({...valid,PORTAL_SERVE_PROXY_PEERS:value}),/PORTAL_SERVE_PROXY_PEERS/);
  });
}
test('renderer never executes deployment commands and fails without emitting partial config',()=>{
  const result=spawnSync(process.execPath,[script],{env:{...process.env,PORTAL_PUBLIC_ORIGIN:'',PORTAL_SERVE_PROXY_PEERS:''},encoding:'utf8'});
  assert.equal(result.status,1);
  assert.equal(result.stdout,'');
  assert.match(result.stderr,/PORTAL_PUBLIC_ORIGIN/);
});
