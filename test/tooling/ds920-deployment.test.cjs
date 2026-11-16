const assert = require('node:assert/strict');
const {readFileSync} = require('node:fs');
const {join} = require('node:path');
const {test} = require('node:test');
const yaml = require('js-yaml');
const root = join(__dirname, '../..');
const deployment = () => yaml.load(readFileSync(join(root, 'deploy/ds920/compose.app.yml'), 'utf8'));
const proxy = () => readFileSync(join(root, 'deploy/ds920/nginx.conf'), 'utf8');

test('DS920 addition cannot replace existing database, cache, proxy or persistent volumes', () => {
  const config = deployment();
  assert.deepEqual(Object.keys(config.services), ['app']);
  assert.equal(config.name, undefined, 'The original project identity must be supplied by the operator');
  assert.equal(config.volumes, undefined);
  assert.equal(config.services.app.build, undefined, 'Never build on the NAS');
  assert.equal(config.services.app.pull_policy, 'never', 'Only a verified locally loaded image may start');
  assert.match(config.services.app.image, /\$\{PORTAL_APP_IMAGE:\?/);
});
test('DS920 application is internal, non-root and joins only the verified existing network', () => {
  const config = deployment(), app = config.services.app;
  assert.equal(app.ports, undefined);
  assert.equal(app.platform, 'linux/amd64');
  assert.match(app.user, /PORTAL_APP_UID:\?.*PORTAL_APP_GID:\?/);
  assert.deepEqual(app.networks, ['portal-existing']);
  assert.equal(config.networks['portal-existing'].external, true);
  assert.match(config.networks['portal-existing'].name, /PORTAL_EXISTING_NETWORK:\?/);
  assert.deepEqual(app.cap_drop, ['ALL']);
  assert.ok(app.security_opt.includes('no-new-privileges:true'));
});
test('DS920 binds preserve legacy read-only access and require a separate preprovisioned managed root', () => {
  const app = deployment().services.app;
  assert.equal(app.volumes.length, 2);
  for (const mount of app.volumes) {
    assert.equal(mount.type, 'bind');
    assert.equal(mount.bind.create_host_path, false);
    assert.match(mount.source, /:\?/);
  }
  assert.equal(app.volumes.find(m => m.target === '/var/lib/portal-bsc/files').read_only, true);
  assert.equal(app.volumes.find(m => m.target === '/var/lib/portal-bsc/uploads').read_only, false);
  for (const name of ['PORTAL_UPLOADS_STORAGE_ID', 'PORTAL_UPLOAD_MIN_FREE_BYTES', 'SESSION_SECRET', 'COUCHDB_USER', 'COUCHDB_PASSWORD'])
    assert.match(app.environment[name], /:\?/, name);
  assert.equal(app.environment.ALLOW_IN_MEMORY_SESSION_STORE, 'false');
  assert.equal(app.env_file, undefined, 'Only explicitly selected environment values should reach the app');
});
test('DS920 proxy is a complete TLS configuration and discards untrusted forwarding claims', () => {
  const config = proxy();
  assert.match(config, /events\s*\{/);
  assert.match(config, /http\s*\{/);
  assert.match(config, /listen\s+443\s+ssl;/);
  assert.doesNotMatch(config, /listen\s+80[;\s]/);
  assert.match(config, /ssl_protocols TLSv1\.2 TLSv1\.3;/);
  assert.match(config, /proxy_set_header X-Forwarded-Proto \$scheme;/);
  assert.match(config, /proxy_set_header X-Forwarded-For \$remote_addr;/);
  assert.doesNotMatch(config, /\$http_x_forwarded|\$proxy_add_x_forwarded_for/);
});
test('DS920 proxy streams bounded uploads without retrying writes or serving files directly', () => {
  const config = proxy();
  assert.match(config, /client_max_body_size 1000000000;/);
  assert.match(config, /proxy_request_buffering off;/);
  assert.match(config, /proxy_buffering off;/);
  assert.match(config, /proxy_next_upstream off;/);
  assert.match(config, /proxy_read_timeout 3600s;/);
  assert.match(config, /resolver 127\.0\.0\.11/);
  assert.match(config, /app:3000/);
  assert.doesNotMatch(config, /\b(alias|root|try_files|autoindex)\s/);
});
test('DS920 proxy retains upstream connections while refreshing recreated app addresses', () => {
  const config = proxy();
  assert.match(config, /upstream portal_application\s*\{/);
  assert.match(config, /zone portal_application 64k;/);
  assert.match(config, /server app:3000 resolve;/);
  assert.match(config, /keepalive 8;/);
  assert.match(config, /proxy_pass http:\/\/portal_application;/);
});
