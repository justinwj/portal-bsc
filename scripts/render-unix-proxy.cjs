const {readFileSync, writeFileSync} = require('node:fs');
const {join} = require('node:path');
const {canonicalOrigin} = require('./render-tailscale-proxy.cjs');

// Offline only. The socket filesystem permissions authenticate the Serve peer.
function renderUnixProxy(env) {
  const origin = canonicalOrigin(env);
  if (!['placeholder', 'app'].includes(env.PORTAL_PROXY_RESPONSE_MODE))
    throw Error('PORTAL_PROXY_RESPONSE_MODE must explicitly select placeholder or app');
  const app = env.PORTAL_PROXY_RESPONSE_MODE === 'app';
  const hosts = [origin.host, ...(!origin.port ? [origin.hostname + ':443'] : [])];
  const values = {
    ORIGIN: origin.origin, HOST: origin.host, HOSTNAME: origin.hostname, PORT: origin.port || '443',
    HOST_ENTRIES: hosts.map(host => `        "${host}" 1;`).join('\n'),
    UPSTREAM: app ? '    upstream portal_application {\n        zone portal_application 64k;\n        server app:3000 resolve;\n        keepalive 8;\n    }' : '',
    RESPONSE: app ? readFileSync(join(__dirname, '../deploy/ds920/nginx.unix-proxy-location.conf'), 'utf8')
      : "            default_type text/plain;\n            return 200 'portal nginx is running';",
  };
  return readFileSync(join(__dirname, '../deploy/ds920/nginx.unix.conf.template'), 'utf8')
    .replace(/@@([A-Z_]+)@@/g, (_, name) => values[name])
    .replace(/@@([A-Z_]+)@@/g, (_, name) => values[name]);
}
module.exports = {renderUnixProxy};
if (require.main === module) {
  try {
    const args = process.argv.slice(2);
    if (args.length && (args.length !== 2 || args[0] !== '--output')) throw Error('Usage: render-unix-proxy.cjs [--output new-file]');
    const config = renderUnixProxy(process.env);
    if (args.length) writeFileSync(args[1], config, {encoding:'utf8', flag:'wx', mode:0o600});
    else process.stdout.write(config);
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
