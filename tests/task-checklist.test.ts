import test from 'node:test';
import assert from 'node:assert/strict';
import { parseTaskChecklist, readTaskChecklist } from '../task-checklist.ts';
const bytes=(s:string)=>new TextEncoder().encode(s);
const plan=bytes('# Plan\n## Task 1: Scoped agents\n- [ ] Step 1: old step\n## Task 2: Real sidebar\n## Coverage and execution checkpoint\n- [x] Task 1 complete.\n- [-] Task 2 in progress.\n');
test('task summary, not stale nested step checkboxes, owns displayed progress',()=>{
  assert.deepEqual(parseTaskChecklist(plan),[{number:1,label:'Scoped agents',state:'done'},{number:2,label:'Real sidebar',state:'active'}]);
});
test('unmarked tasks remain pending and completion is never guessed from prose',()=>{
  assert.deepEqual(parseTaskChecklist(bytes('## Task 1: Repair\nEverything looks done')), [{number:1,label:'Repair',state:'pending'}]);
});
test('malformed, duplicate or oversized plans are not invented checklists',()=>{
  assert.throws(()=>parseTaskChecklist(bytes('No tasks')));
  assert.throws(()=>parseTaskChecklist(bytes('## Task 1: One\n## Task 1: Other')));
  assert.throws(()=>parseTaskChecklist(new Uint8Array(128*1024+1)));
});
test('fenced checklist examples cannot complete real tasks',()=>{
  const items=parseTaskChecklist(bytes('## Task 1: Real\n~~~md\n- [x] Task 1 complete.\n## Task 2: Example\n~~~'));
  assert.deepEqual(items,[{number:1,label:'Real',state:'pending'}]);
});
test('only a curated plan directory and relative plan path can be read',async()=>{
  const selection={sessionID:'root',directory:'/project',revision:1};let reads=0;
  const port={read:async()=>{reads++;return plan;}};
  for(const ref of [{directory:'/etc',path:'docs/superpowers/plans/p.md'},{directory:'/plans',path:'../secret.md'},{directory:'/plans',path:'docs/superpowers/plans/../../secret.md'}]){
    assert.equal((await readTaskChecklist(selection,ref,['/project','/plans'],port,new AbortController().signal)).kind,'unavailable');
  }
  assert.equal(reads,0);
  const result=await readTaskChecklist(selection,{directory:'/plans',path:'docs/superpowers/plans/p.md'},['/project','/plans'],port,new AbortController().signal);
  assert.equal(result.kind,'ready');assert.equal(reads,1);
});
