const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { it } = require('node:test');
const yaml = require('js-yaml');
it('production runtime selects a non-root application identity', () => {
  const runtime = readFileSync('Dockerfile', 'utf8').split(/FROM .* AS runtime/i)[1];
  const users = [...runtime.matchAll(/^USER\s+(.*)$/gm)];
  assert.ok(users.length, 'The runtime must explicitly select its unprivileged user');
  assert.doesNotMatch(users.at(-1)[1], /^(root|0)(:|\s|$)/);
});
it('production Compose requires verified runtime UID/GID and keeps the legacy NAS bind read-only', () => {
  const app = yaml.load(readFileSync('docker-compose.app.yml', 'utf8')).services.app;
  assert.match(app.user, /PORTAL_APP_UID:\?/); assert.match(app.user, /PORTAL_APP_GID:\?/);
  const legacy = app.volumes.find(v => v.target === '/var/lib/portal-bsc/files');
  assert.equal(legacy.read_only, true); assert.equal(legacy.bind.create_host_path, false);
});
it('managed uploads use a separate opt-in bind with required host path and no automatic creation', () => {
  const app = yaml.load(readFileSync('docker-compose.uploads.yml', 'utf8')).services.app;
  assert.equal(app.environment.PORTAL_UPLOADS_ENABLED, 'true');
  const managed = app.volumes.find(v => v.target === '/var/lib/portal-bsc/uploads');
  assert.equal(managed.type, 'bind'); assert.equal(managed.read_only, false);
  assert.match(managed.source, /PORTAL_UPLOADS_HOST_PATH:\?/); assert.equal(managed.bind.create_host_path, false);
  assert.ok(!app.volumes.some(v => v.target === '/var/lib/portal-bsc/files'), 'The writable override must not replace the legacy mount');
});
it('managed storage identity and disk reserve must be explicitly selected for deployment', () => {
  const env = yaml.load(readFileSync('docker-compose.uploads.yml', 'utf8')).services.app.environment;
  assert.match(env.PORTAL_UPLOADS_STORAGE_ID, /PORTAL_UPLOADS_STORAGE_ID:\?/);
  assert.match(env.PORTAL_UPLOAD_MIN_FREE_BYTES, /PORTAL_UPLOAD_MIN_FREE_BYTES:\?/);
  assert.equal(env.PORTAL_UPLOADS_DIR, '/var/lib/portal-bsc/uploads');
});
it('Docker build context excludes the conventional local upload directory', () => {
  assert.match(readFileSync('.dockerignore', 'utf8'), /^uploads\/?\s*$/m);
});
