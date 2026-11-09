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
