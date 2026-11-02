const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const {spawnSync} = require('node:child_process');
const {before, describe, it} = require('node:test');
const {ROOT, project} = require('./support.cjs');
const TSC = require.resolve('typescript/bin/tsc');
function files(dir) { const f=require('node:fs'); return f.readdirSync(dir,{withFileTypes:true}).flatMap(e=>e.isDirectory()?files(path.join(dir,e.name)):[path.join(dir,e.name)]); }
describe('production TypeScript build contract', {concurrency:false}, () => {
  let output;
  before(async () => {
    output = path.join(ROOT,'tmp/tooling-build-contract');
    const config=path.join(ROOT,'tmp/tooling-build-contract.json');
    await fs.mkdir(path.dirname(config),{recursive:true});
    await fs.writeFile(config,JSON.stringify({extends:path.join(ROOT,'tsconfig.build.json'),compilerOptions:{outDir:output,incremental:false}}));
    const result=spawnSync(process.execPath,[TSC,'-p',config],{encoding:'utf8',cwd:ROOT});
    assert.equal(result.status,0,result.stdout+result.stderr);
  });
  it('emits main and administrator bootstrap entrypoints with source maps', async () => {
    for (const entry of ['main','seed-admin']) {
      assert.ok((await fs.stat(path.join(output,`${entry}.js`))).isFile());
      const map=JSON.parse(await fs.readFile(path.join(output,`${entry}.js.map`),'utf8'));
      assert.ok(map.sources.some(s=>s.endsWith(`/src/${entry}.ts`)));
    }
  });
  it('preserves executable Nest decorator constructor metadata', () => {
    const script="require('reflect-metadata');const {AuthGuard}=require("+JSON.stringify(path.join(output,'common/guards/auth.guard.js'))+");if(Reflect.getMetadata('design:paramtypes',AuthGuard)[0].name!=='UsersService')process.exit(2);";
    const result=spawnSync(process.execPath,['-e',script],{encoding:'utf8',cwd:ROOT});
    assert.equal(result.status,0,result.stdout+result.stderr);
  });
  it('excludes all application test JavaScript, declarations and maps from production', () => {
    assert.deepEqual(files(output).filter(p=>/\.(test|spec)\.(js|d\.ts|js\.map)$/.test(p)),[]);
  });
  it('does not emit invalid JavaScript when compilation fails', async t => {
    const fixture=await project(t,true);
    const config=path.join(fixture.directory,'build.json');
    const out=path.join(fixture.directory,'out');
    await fs.writeFile(config,JSON.stringify({extends:path.join(ROOT,'tsconfig.build.json'),compilerOptions:{outDir:out,incremental:false,types:[]},include:['src/**/*.ts']}));
    const result=spawnSync(process.execPath,[TSC,'-p',config],{encoding:'utf8'});
    assert.notEqual(result.status,0);
    assert.match(result.stdout,/TS2322/);
    assert.equal(require('node:fs').existsSync(path.join(out,'main.js')),false);
  });
  it('cleans previously emitted stale test artifacts during the supported production build', async () => {
    await fs.mkdir(path.join(ROOT,'dist'),{recursive:true});
    await fs.writeFile(path.join(ROOT,'dist/stale.test.js'),'// old output');
    const result=spawnSync(process.execPath,[path.join(ROOT,'scripts/build.cjs')],{encoding:'utf8',cwd:ROOT});
    assert.equal(result.status,0,result.stdout+result.stderr);
    assert.ok(require('node:fs').existsSync(path.join(ROOT,'dist/main.js')));
    assert.deepEqual(files(path.join(ROOT,'dist')).filter(p=>/\.(test|spec)\.(js|d\.ts|js\.map)$/.test(p)),[]);
  });
});
