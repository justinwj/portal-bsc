import assert from 'node:assert/strict';
import { it } from 'node:test';

it('parses decimal GB to exact byte integers and distinguishes all policy modes',()=>{
  const {parseStorageLimit,storageText}=require('./quota-policy');
  assert.deepEqual(parseStorageLimit('not-configured'),{mode:'not-configured'});
  assert.deepEqual(parseStorageLimit('unlimited'),{mode:'unlimited'});
  assert.deepEqual(parseStorageLimit('0'),{mode:'limited',bytes:'0'});
  assert.deepEqual(parseStorageLimit('1.000000001'),{mode:'limited',bytes:'1000000001'});
  assert.equal(storageText(parseStorageLimit('9007199.254740991')),'9007199.254740991');
});
it('rejects noncanonical, negative, fractional-byte, non-string and overflowing policy values',()=>{
  const {parseStorageLimit,parseCountLimit}=require('./quota-policy');
  for(const value of ['-1','1e9','NaN','Infinity','01','0.0000000001','9007199.254740992','',1,null])assert.throws(()=>parseStorageLimit(value));
  for(const value of ['3.1','9007199254740992','-1','01','',1])assert.throws(()=>parseCountLimit(value));
  assert.deepEqual(parseCountLimit('0'),{mode:'limited',count:0});
});
it('deduplicates file IDs, sums exactly and separates global completeness from ownership completeness',()=>{
  const {collectUsage}=require('./quota-policy');const file={_id:'a',type:'file',storageScope:'portal-managed',sizeBytes:101,uploadedByUserId:'u'};
  const report=collectUsage([file,{...file},{...file,_id:'b',sizeBytes:202,uploadedByUserId:'missing'}],[{_id:'u',type:'user'}]);
  assert.equal(report.knownBytes,303n);assert.equal(report.perUser.get('u'),101n);assert.equal(report.unattributedBytes,202n);assert.equal(report.complete,true);assert.equal(report.attributionComplete,false);
});
it('marks invalid metadata incomplete rather than treating unknown sizes as zero usage',()=>{
  const {collectUsage}=require('./quota-policy');const report=collectUsage([{_id:'a',type:'file',storageScope:'portal-managed',sizeBytes:-1}],[]);
  assert.equal(report.complete,false);assert.equal(report.knownBytes,0n);assert.ok(report.warnings.length>0);
});
it('does not guess a storage classification when duplicate file IDs disagree about managed scope',()=>{
  const {collectUsage}=require('./quota-policy');const file={_id:'ambiguous',type:'file',storageScope:'portal-managed',sizeBytes:100,uploadedByUserId:'u'};
  const report=collectUsage([file,{...file,storageScope:'external-nas'}],[{_id:'u',type:'user'}]);
  assert.equal(report.complete,false);assert.equal(report.knownBytes,0n);assert.ok(report.warnings.length>0);
});
it('rejects corrupt stored policy objects without coercing or replacing their values',()=>{
  const {defaultPortalSettings,validatePortalSettings,validateStorageLimit}=require('./quota-policy');
  assert.throws(()=>validatePortalSettings({...defaultPortalSettings(),maxActiveUsers:{mode:'limited',count:'3'}}));
  assert.throws(()=>validateStorageLimit({mode:'unlimited',bytes:'5'}));
  assert.throws(()=>validateStorageLimit({mode:'limited',bytes:'-1'}));
});
it('includes pending reservations exactly once but excludes verified aborted upload journals',()=>{
  const {collectUsage}=require('./quota-policy'),base={type:'file',storageScope:'portal-managed',schemaVersion:2,sizeBytes:3,uploadedByUserId:'u'},upload={reservedBytes:'3',declaredBytes:'3'};
  const report=collectUsage([{...base,_id:'pending',upload:{...upload,state:'reserved'}},{...base,_id:'done',upload:{...upload,state:'committed'}},{...base,_id:'aborted',upload:{...upload,state:'aborted'}}],[{_id:'u',type:'user'}]);
  assert.equal(report.knownBytes,6n);assert.equal(report.perUser.get('u'),6n);assert.equal(report.complete,true);
  assert.equal(report.committedBytes,3n);assert.equal(report.reservedBytes,3n);
});
it('reports unknown or conflicting upload state and reservation sizes as incomplete',()=>{
  const {collectUsage}=require('./quota-policy'),base={_id:'a',type:'file',storageScope:'portal-managed',schemaVersion:2,sizeBytes:3,uploadedByUserId:'u',upload:{state:'reserved',reservedBytes:'3',declaredBytes:'3'}};
  for(const files of [[{...base,upload:{...base.upload,state:'unknown'}}],[{...base,upload:{...base.upload,reservedBytes:'2'}}],[base,{...base,upload:{...base.upload,state:'aborted'}}]])assert.equal(collectUsage(files,[{_id:'u',type:'user'}]).complete,false);
});
