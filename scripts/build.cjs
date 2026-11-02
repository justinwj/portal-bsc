const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const ts = require('typescript');

const root = path.resolve(__dirname, '..');
const configPath = path.join(root, 'tsconfig.build.json');
const config = ts.readConfigFile(configPath, ts.sys.readFile);
if (config.error) throw Error(ts.flattenDiagnosticMessageText(config.error.messageText, '\n'));
const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, root);
const output = path.resolve(parsed.options.outDir);
// Clean only this repository's generated directory, never a configured external
// directory or a symlink to user/NAS storage. Cleaning removes legacy test output.
if (output !== path.join(root, 'dist')) throw Error('Production output must be the repository dist directory');
if (fs.existsSync(output) && fs.lstatSync(output).isSymbolicLink()) throw Error('Refusing to clean a symlinked dist directory');
fs.rmSync(output, { recursive: true, force: true });
const result = spawnSync(process.execPath, [require.resolve('typescript/bin/tsc'), '-p', configPath],
  { cwd: root, stdio: 'inherit', windowsHide: true });
if (result.error) console.error(result.error.message);
process.exitCode = result.status ?? 1;
