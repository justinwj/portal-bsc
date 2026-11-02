const { readdirSync } = require('node:fs');
const { join } = require('node:path');
const { spawn } = require('node:child_process');

const suite = process.argv[2] ?? 'unit';
if (!['unit', 'integration', 'persistence'].includes(suite)) throw new Error(`Unknown suite: ${suite}`);
const integration = suite !== 'unit';
if (integration && process.env.INTEGRATION_TESTS !== '1') {
  throw new Error('Set INTEGRATION_TESTS=1 and test-only REDIS_URL/COUCHDB_URL to run dependency tests');
}

function discover(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? discover(path) : entry.name.endsWith('.test.ts') ? [path] : [];
  });
}

const files = discover(suite === 'unit' ? 'src' : `test/${suite}`).sort();
if (!files.length) throw new Error('No test files discovered');
const child = spawn(process.execPath, [
  '--test', '--test-concurrency=1', '--test-reporter=tap', '--require', 'ts-node/register', ...files,
], { stdio: ['inherit', 'pipe', 'inherit'] });
let output = '';
child.stdout.on('data', (chunk) => {
  output += chunk.toString();
  process.stdout.write(chunk);
});
child.on('error', (error) => { console.error(error); process.exitCode = 1; });
child.on('close', (code) => {
  const count = (name) => Number(new RegExp(`^# ${name} (\\d+)\\s*$`, 'm').exec(output)?.[1] ?? 0);
  if (count('tests') === 0 || count('pass') + count('fail') === 0) {
    console.error('No tests executed (empty or entirely skipped suite)');
    process.exitCode = 1;
  } else {
    process.exitCode = code === 0 ? 0 : 1;
  }
});
