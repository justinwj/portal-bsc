import assert from 'node:assert/strict';
import {test} from 'node:test';
import {managedVisibility as mode} from './file-visibility';
for(const visibility of ['all-members','selected-members','private'])test(`managed visibility retains explicit ${visibility}`,()=>{
  assert.equal(mode({visibility,sharedWithUserIds:[]}),visibility);
});
test('legacy selected recipients never become all-member access',()=>assert.equal(mode({visibility:'private',sharedWithUserIds:['old-recipient']}),'selected-members'));
test('missing legacy policy remains private',()=>assert.equal(mode({sharedWithUserIds:[]}),'private'));
test('unknown or public managed policy fails closed',()=>{for(const visibility of ['public','unknown',null])assert.throws(()=>mode({visibility,sharedWithUserIds:[]}));});
