/** Resolve explicit credentials first; accept a complete legacy URL pair when none are supplied. */
export function couchDbConnection(env: Record<string, any> = process.env, requireCredentials = env.NODE_ENV === 'production') {
  if (requireCredentials && !env.COUCHDB_URL?.trim()) {
    throw new Error('COUCHDB_URL is required');
  }
  let url: URL;
  try { url = new URL(env.COUCHDB_URL || 'http://localhost:5984'); }
  catch { throw new Error('COUCHDB_URL must be a valid HTTP or HTTPS URL'); }
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('COUCHDB_URL must use HTTP or HTTPS');
  const explicit = env.COUCHDB_USER !== undefined || env.COUCHDB_PASSWORD !== undefined;
  const username = explicit ? env.COUCHDB_USER : decodeURIComponent(url.username);
  const password = explicit ? env.COUCHDB_PASSWORD : decodeURIComponent(url.password);
  if (requireCredentials || explicit || username || password) {
    if (!username?.trim() || !password?.trim()) {
      throw new Error('CouchDB authentication requires both COUCHDB_USER and COUCHDB_PASSWORD, or a complete credential pair in COUCHDB_URL');
    }
  }
  // Keep secrets out of the connection URL and pass them only as HTTP authentication.
  url.username = '';
  url.password = '';
  return { url: url.toString(), auth: username && password ? { username, password } : undefined };
}
