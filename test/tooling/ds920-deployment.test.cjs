const assert = require('node:assert/strict');
const {readFileSync} = require('node:fs');
const {join} = require('node:path');
const {test} = require('node:test');
const yaml = require('js-yaml');
const root = join(__dirname, '../..');
const deployment = () => yaml.load(readFileSync(join(root, 'deploy/ds920/compose.app.yml'), 'utf8'));
const proxy = () => readFileSync(join(root, 'deploy/ds920/nginx.conf'), 'utf8');
const httpProxy = () => readFileSync(join(root, 'deploy/ds920/nginx.http-proposal.conf'), 'utf8');

test('DS920 addition cannot replace existing database, cache, proxy or persistent volumes', () => {
  const config = deployment();
  assert.deepEqual(Object.keys(config.services), ['app']);
  assert.equal(config.name, undefined, 'The original project identity must be supplied by the operator');
  assert.equal(config.volumes, undefined);
  assert.equal(config.services.app.build, undefined, 'Never build on the NAS');
  assert.equal(config.services.app.pull_policy, 'never', 'Only a verified locally loaded image may start');
  assert.match(config.services.app.image, /\$\{PORTAL_APP_IMAGE:\?/);
});
test('DS920 application is internal, non-root and inherits the original implicit default network', () => {
  const config = deployment(), app = config.services.app;
  assert.equal(app.ports, undefined);
  assert.equal(app.platform, 'linux/amd64');
  assert.match(app.user, /PORTAL_APP_UID:\?.*PORTAL_APP_GID:\?/);
  assert.deepEqual(app.networks, ['default']);
  assert.equal(config.networks, undefined, 'Do not define a competing network or assume a NAS network name');
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
test('DS920 HTTP routing proposal supports the existing frontend without selecting TLS or changing host ports', () => {
  const config = httpProxy();
  assert.match(config, /events\s*\{/);
  assert.match(config, /http\s*\{/);
  assert.match(config, /listen 80;/);
  assert.match(config, /worker_connections 1024;/);
  for (const candidate of [config, proxy()])
    assert.doesNotMatch(candidate, /^\s*pid\s/m, 'Inherit the running original daemon PID path during reload');
  assert.doesNotMatch(config, /listen\s+(443|8088)\b|ssl_certificate|\bssl_protocols/);
  assert.match(config, /proxy_pass http:\/\/portal_application;/);
  assert.match(config, /server app:3000 resolve;/);
  assert.equal(deployment().services.app.ports, undefined);
});
test('DS920 HTTP routing cannot spoof HTTPS, bypass file authorization or regress streaming keepalive', () => {
  const config = httpProxy();
  assert.match(config, /proxy_set_header X-Forwarded-Proto \$scheme;/);
  assert.match(config, /proxy_set_header X-Forwarded-For \$remote_addr;/);
  assert.doesNotMatch(config, /\$http_x_forwarded|\$proxy_add_x_forwarded_for|X-Forwarded-Proto https/);
  assert.match(config, /keepalive 8;/);
  assert.match(config, /client_max_body_size 1000000000;/);
  assert.match(config, /proxy_request_buffering off;/);
  assert.match(config, /proxy_buffering off;/);
  assert.match(config, /proxy_next_upstream off;/);
  assert.doesNotMatch(config, /\b(alias|root|try_files|autoindex)\s/);
});
test('DS920 reference preserves the supplied three-service identities, ports, commands and all five existing binds', () => {
  const config = yaml.load(readFileSync(join(root, 'deploy/ds920/compose.infrastructure.yml'), 'utf8'));
  assert.deepEqual(Object.keys(config.services).sort(), ['couchdb', 'nginx', 'redis']);
  assert.equal(config.networks, undefined);
  assert.equal(config.volumes, undefined);
  for (const [name, image] of [['nginx', 'nginx:stable-alpine'], ['couchdb', 'couchdb:3'], ['redis', 'redis:7-alpine']]) {
    assert.equal(config.services[name].image, image);
    assert.equal(config.services[name].container_name, `portal-${name}`);
    assert.equal(config.services[name].restart, 'unless-stopped');
    assert.equal(config.services[name].user, undefined, 'Preserve existing service user configuration');
  }
  assert.deepEqual(config.services.nginx.ports, ['8088:80']);
  assert.deepEqual(config.services.couchdb.ports, ['127.0.0.1:5984:5984']);
  assert.deepEqual(config.services.redis.ports, ['127.0.0.1:6379:6379']);
  assert.deepEqual(config.services.redis.command, ['redis-server', '--save', '', '--appendonly', 'no']);
  assert.deepEqual(config.services.nginx.depends_on, ['couchdb', 'redis']);
  const mounts = name => config.services[name].volumes.map(m => {
    assert.equal(m.type, 'bind'); assert.equal(m.bind.create_host_path, false);
    return [m.source, m.target, m.read_only];
  });
  assert.deepEqual(mounts('nginx'), [
    ['/volume1/docker/portal/nginx/nginx.conf', '/etc/nginx/nginx.conf', true],
    ['/volume1/docker/portal/files', '/srv/portal-files', true],
    ['/volume1/docker/portal/logs', '/var/log/nginx', false],
  ]);
  assert.deepEqual(mounts('couchdb'), [
    ['/volume1/docker/portal/couchdb/data', '/opt/couchdb/data', false],
    ['/volume1/docker/portal/couchdb/config', '/opt/couchdb/etc/local.d', false],
  ]);
  for (const key of ['COUCHDB_USER', 'COUCHDB_PASSWORD']) assert.match(config.services.couchdb.environment[key], /:\?/);
  const original = readFileSync(join(root, 'deploy/ds920/nginx.original-placeholder.conf'), 'utf8');
  assert.match(original, /worker_connections 1024;/);
  assert.match(original, /return 200 'portal nginx is running';/);
  assert.doesNotMatch(original, /proxy_pass|\b(alias|root)\s/);
});
