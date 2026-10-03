import test from 'node:test';
import assert from 'node:assert/strict';
import { interruptSession, readOwnedOutput, createOutputView } from '../actions.ts';
import { snapshot, shell } from './fixtures.ts';

function port() {
  const data = snapshot(); const calls: string[] = [];
  const value = {
    currentSelection: () => data.selection, freshSnapshot: async () => data,
    confirm: async () => true,
    interrupt: async (id: string, resume: false) => { assert.equal(resume, false); calls.push(id); },
  };
  return { value, data, calls };
}
test('only a fresh confirmed active family member can receive one interrupt request', async () => {
  const p = port();
  assert.equal((await interruptSession('foreign', p.data.selection, p.value)).kind, 'stale');
  assert.equal(p.calls.length, 0);
  assert.equal((await interruptSession('root', p.data.selection, p.value)).kind, 'sent');
  assert.deepEqual(p.calls, ['root']);
});
test('confirmation rejection and selection drift never dispatch', async () => {
  const p = port(); const origin = { ...p.data.selection };
  p.value.confirm = async () => false;
  assert.equal((await interruptSession('root', origin, p.value)).kind, 'cancelled');
  p.value.confirm = async () => { p.data.selection = { ...origin, revision: 2 }; return true; };
  assert.equal((await interruptSession('root', origin, p.value)).kind, 'stale');
  assert.equal(p.calls.length, 0);
});
test('inactive or removed target after confirmation and concurrent duplicate clicks are guarded', async () => {
  const p = port();
  p.value.confirm = async () => { p.data.activity = { kind: 'ready', value: new Set() }; return true; };
  assert.equal((await interruptSession('root', p.data.selection, p.value)).kind, 'stale');
  assert.equal(p.calls.length, 0);
  const q = port(); let release!: (v: boolean) => void;
  q.value.confirm = () => new Promise(resolve => { release = resolve; });
  const first = interruptSession('root', q.data.selection, q.value);
  await Promise.resolve(); await Promise.resolve();
  assert.equal((await interruptSession('root', q.data.selection, q.value)).kind, 'cancelled');
  release(true); assert.equal((await first).kind, 'sent'); assert.equal(q.calls.length, 1);
});
test('denial or unavailability does not retry and cannot claim interrupted outcome', async () => {
  for (const status of [403, 503]) {
    const p = port(); let attempts = 0;
    p.value.interrupt = async () => { attempts++; throw Object.assign(new Error('failure'), { status }); };
    assert.equal((await interruptSession('root', p.data.selection, p.value)).kind, status === 403 ? 'denied' : 'unavailable');
    assert.equal(attempts, 1);
  }
});
test('only owned output is fetched with an 8 KiB limit and stale results are discarded', async () => {
  const data = snapshot({ shells: { kind: 'ready', value: [shell('owned', 'root'), shell('foreign', 'other')] } });
  const requests: string[] = [];
  const p = { currentSelection: () => data.selection, freshSnapshot: async () => data, output: async (dir: string, id: string, cursor: number, limit: number) => {
    assert.equal(dir, '/workspace'); assert.equal(cursor, 0); assert.equal(limit, 8192); requests.push(id);
    return { output: 'tiếng Việt\u001b[31m\n' + '🙂'.repeat(3000), cursor: 8192, size: 13000, truncated: true };
  } };
  assert.equal((await readOwnedOutput('foreign', data.selection, p, new AbortController().signal)).kind, 'stale');
  assert.equal(requests.length, 0);
  const result = await readOwnedOutput('owned', data.selection, p, new AbortController().signal);
  assert.equal(result.kind, 'ready');
  if (result.kind === 'ready') { assert.ok(Buffer.byteLength(result.output) <= 8192); assert.equal(result.truncated, true); assert.ok(!result.output.includes('\u001b')); assert.equal(result.cursor, 8192); }
  const origin = { ...data.selection };
  p.output = async () => { data.selection = { ...origin, revision: 2 }; return { output: 'old', cursor: 3, size: 3, truncated: false }; };
  assert.equal((await readOwnedOutput('owned', origin, p, new AbortController().signal)).kind, 'stale');
});
test('selection drift inside fresh ownership read never fetches output',async()=>{
  const data=snapshot({shells:{kind:'ready',value:[shell('owned','root')]}});const origin={...data.selection};let calls=0;
  const p={currentSelection:()=>data.selection,freshSnapshot:async()=>{const old={...data,selection:origin};data.selection={...origin,revision:2};return old;},output:async()=>{calls++;return {output:'secret',cursor:6,size:6,truncated:false};}};
  assert.equal((await readOwnedOutput('owned',origin,p,new AbortController().signal)).kind,'stale');assert.equal(calls,0);
});
test('closing the output view aborts the read and never publishes its late result',async()=>{
  const data=snapshot({shells:{kind:'ready',value:[shell('owned','root')]}});let signal!:AbortSignal,release:()=>void=()=>{};let published=0;
  const p={currentSelection:()=>data.selection,freshSnapshot:async()=>data,output:async(_d:string,_id:string,_c:number,_l:number,s:AbortSignal)=>{signal=s;await new Promise<void>(r=>release=r);return {output:'old',cursor:3,size:3,truncated:false};}};
  const view=createOutputView(p,()=>published++);const pending=view.open('owned',data.selection);await Promise.resolve();view.close();
  assert.equal(signal.aborted,true);release();await pending;assert.equal(published,0);
});
