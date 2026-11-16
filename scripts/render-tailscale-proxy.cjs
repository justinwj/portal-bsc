const {readFileSync} = require('node:fs');
const {join} = require('node:path');
const {isIP} = require('node:net');

// Offline rendering only: no NAS access, file writes, network calls or deployment.
function renderTailscaleProxy(env) {
  const input = env.PORTAL_PUBLIC_ORIGIN;
  let origin;
  try { origin = new URL(input); } catch { throw Error('PORTAL_PUBLIC_ORIGIN must be an HTTPS origin'); }
  const dns = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
  if (typeof input !== 'string' || input !== input.trim() || origin.protocol !== 'https:'
      || origin.username || origin.password || origin.pathname !== '/' || origin.search || origin.hash
      || origin.hostname.length > 253 || isIP(origin.hostname) || !dns.test(origin.hostname))
    throw Error('PORTAL_PUBLIC_ORIGIN must contain only an HTTPS DNS origin');
  const raw = env.PORTAL_SERVE_PROXY_PEERS;
  const peers = typeof raw === 'string' ? raw.split(',').map(value => value.trim()) : [];
  if (!peers.length || peers.length > 4 || peers.some(value => !isIP(value) || value.includes('%'))
      || new Set(peers).size !== peers.length)
    throw Error('PORTAL_SERVE_PROXY_PEERS requires 1-4 distinct observed IP literals; no networks or hostnames');
  const hosts = [origin.host, ...(!origin.port ? [origin.hostname + ':443'] : [])];
  const values = {
    ORIGIN: origin.origin,
    HOST: origin.host,
    HOSTNAME: origin.hostname,
    PORT: origin.port || '443',
    REAL_IP_SOURCES: peers.map(value => `    set_real_ip_from ${value};`).join('\n'),
    PEER_ENTRIES: peers.map(value => `        ${value} 1;`).join('\n'),
    HOST_ENTRIES: hosts.map(value => `        "${value}" 1;`).join('\n'),
  };
  return readFileSync(join(__dirname, '../deploy/ds920/nginx.tailscale.conf.template'), 'utf8')
    .replace(/@@([A-Z_]+)@@/g, (_match, name) => {
      if (!(name in values)) throw Error('Unknown proxy template field');
      return values[name];
    });
}

module.exports = {renderTailscaleProxy};
if (require.main === module) {
  try { process.stdout.write(renderTailscaleProxy(process.env)); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
