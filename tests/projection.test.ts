import test from 'node:test';
import assert from 'node:assert/strict';
import { projectMonitor, safeLabel } from '../projection.ts';
import { snapshot, session, shell } from './fixtures.ts';

test('excludes foreign and unknown shell ownership even in the same directory', () => {
  const view = projectMonitor(snapshot({
    sessions: { kind: 'ready', value: [session('root'), session('child', 'root'), session('foreign')] },
    shells: { kind: 'ready', value: [shell('owned', 'child'), shell('foreign-shell', 'foreign'), shell('unknown')] },
  }));
  assert.equal(view.familyIDs.has('foreign'), false);
  assert.deepEqual(view.shells.map(row => row.id), ['owned']);
});
test('shell reader location and selected location must agree', () => {
  assert.equal(projectMonitor(snapshot({ shellDirectory: '/other', shells: { kind: 'ready', value: [shell('x', 'root')] } })).shells.length, 0);
});
test('missing sources are not successful or known-empty', () => {
  for (const kind of ['loading', 'denied', 'unavailable', 'stale'] as const) {
    const view = projectMonitor(snapshot({ sessions: { kind, reason: 'offline' }, requests: { kind, reason: 'offline' } }));
    assert.equal(view.state, kind);
    assert.equal(view.canInterrupt, false);
    assert.equal(view.attentionKnown, false);
  }
  assert.equal(projectMonitor(snapshot({ activity: { kind: 'loading' } })).state, 'loading');
});
test('inactive without a native outcome never means succeeded', () => {
  assert.equal(projectMonitor(snapshot({ activity: { kind: 'ready', value: new Set() } })).state, 'inactive');
  for (const outcome of ['succeeded', 'failed', 'interrupted'] as const) {
    assert.equal(projectMonitor(snapshot({ sessions: { kind: 'ready', value: [{ ...session('root'), outcome }] }, activity: { kind: 'ready', value: new Set() } })).state, outcome);
  }
});
test('only native-active agents and commands enter running summaries', () => {
  const view=projectMonitor(snapshot({sessions:{kind:'ready',value:[session('root'),session('old','root'),session('live','root')]},activity:{kind:'ready',value:new Set(['root','live'])},shells:{kind:'ready',value:[{...shell('finished','root'),status:'exited'},shell('live-command','root')]}}));
  assert.deepEqual(view.runningChildren.map(r=>r.id),['live']);
  assert.deepEqual(view.runningShells.map(r=>r.id),['live-command']);
});
test('running execution takes precedence over an old outcome', () => {
  assert.equal(projectMonitor(snapshot({ sessions: { kind: 'ready', value: [{ ...session('root'), outcome: 'failed' }] } })).state, 'running');
});
test('selected permissions/forms indicate waiting but child requests do not pause the parent', () => {
  const base = snapshot({ sessions: { kind: 'ready', value: [session('root'), session('child', 'root')] }, requests: { kind: 'ready', value: [{ id: 'q', sessionID: 'child', kind: 'question', label: 'Question' }, { id: 'foreign', sessionID: 'other', kind: 'permission', label: 'Read' }] } });
  assert.equal(projectMonitor(base).state, 'running');
  assert.deepEqual(projectMonitor(base).attention.map(row => row.id), ['q']);
  base.requests = { kind: 'ready', value: [{ id: 'p', sessionID: 'root', kind: 'permission', label: 'Read' }] };
  assert.equal(projectMonitor(base).state, 'waiting-permission');
  base.requests.value[0].kind = 'question';
  assert.equal(projectMonitor(base).state, 'waiting-input');
});
test('cycles or absent selected records cannot grant family/action authority', () => {
  const view = projectMonitor(snapshot({ sessions: { kind: 'ready', value: [session('root', 'child'), session('child', 'root')] } }));
  assert.equal(view.familyIDs.size, 0);
  assert.equal(view.canInterrupt, false);
  assert.equal(projectMonitor(snapshot({ sessions: { kind: 'ready', value: [] } })).state, 'unavailable');
});
test('current tools require exact selected ownership and a running native state', () => {
  const tools = [{ id: 'old', sessionID: 'root', name: 'shell', status: 'error', created: 1 }, { id: 'foreign', sessionID: 'other', name: 'shell', status: 'running', created: 5 }, { id: 'current', sessionID: 'root', name: 'read', status: 'running', created: 3 }] as const;
  assert.equal(projectMonitor(snapshot({ tools: { kind: 'ready', value: tools } })).currentTool?.id, 'current');
});
test('hundreds of historical items stay bounded while attention counts remain honest', () => {
  const sessions = [session('root'), ...Array.from({ length: 100 }, (_, n) => ({ ...session(`c${n}`, 'root'), outcome: 'succeeded' as const }))];
  const requests = Array.from({ length: 20 }, (_, n) => ({ id: `p${n}`, sessionID: 'root', kind: 'permission' as const, label: 'Read' }));
  const view = projectMonitor(snapshot({ sessions: { kind: 'ready', value: sessions }, requests: { kind: 'ready', value: requests }, activity: { kind: 'ready', value: new Set(['root', 'c99']) } }));
  assert.equal(view.children[0].id, 'c99');
  assert.ok(view.children.length <= 8);
  assert.equal(view.attentionCount, 20);
  assert.equal(view.complete, false);
});
test('display text cannot emit terminal-control or bidi sequences and preserves Unicode', () => {
  assert.equal(safeLabel('Tiếng Việt 👩‍💻\u001b[31m\u202ESECRET\nnext'), 'Tiếng Việt 👩‍💻SECRET next');
});
