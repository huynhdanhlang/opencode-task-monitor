import test from 'node:test';
import assert from 'node:assert/strict';
import { parseProjectContext, readProjectContext } from '../project-context.ts';
const bytes = (s: string) => new TextEncoder().encode(s);
const roadmap = bytes('# Roadmap\n## Next exact action\n\n**Next:** repair Settings.\n\nOld history\n## Later\nLater work');
const plan = bytes('# Plan\n## Current checkpoint — today\n\n0/3; no release.\n\n## 1. Implementation\nOld details');
const selection = { sessionID: 'root', directory: '/workspace', revision: 1 };
test('reads exactly the two attributed authority sections, without interpreting readiness', () => {
  const value = parseProjectContext(roadmap, plan);
  assert.equal(value.nextAction, '**Next:** repair Settings.');
  assert.equal(value.checkpoint, '0/3; no release.');
});
test('missing, duplicate and malformed UTF-8 sources fail explicitly', () => {
  for (const invalid of [bytes('## Wrong\nNothing'), bytes('## Next exact action\nA\n## Next exact action\nB'), new Uint8Array([0xff])]) {
    assert.throws(() => parseProjectContext(invalid, plan));
  }
});
test('fenced example headings cannot provide authoritative project sections',()=>{
  assert.throws(()=>parseProjectContext(bytes('```md\n## Next exact action\nFake next\n```'),plan));
});
test('byte bounds reject rather than truncate authority', () => {
  assert.throws(() => parseProjectContext(new Uint8Array(128 * 1024 + 1), plan), /size/);
  const huge = bytes('## Current checkpoint\n' + 'a'.repeat(24 * 1024 + 1) + '\n## Next');
  assert.throws(() => parseProjectContext(roadmap, huge), /size/);
});
test('unmatched locations read nothing and matched locations use only relative allowlisted paths', async () => {
  const paths: string[] = [];
  const port = { read: async (directory: string, path: string) => { assert.equal(directory, '/workspace'); paths.push(path); return path.includes('ROADMAP') ? roadmap : plan; } };
  assert.equal((await readProjectContext(selection, { directory: '/other' }, port, new AbortController().signal)).kind, 'unmatched');
  assert.equal(paths.length, 0);
  assert.equal((await readProjectContext(selection, { directory: '/workspace' }, port, new AbortController().signal)).kind, 'ready');
  assert.deepEqual(paths, ['docs/ROADMAP_HANDOFF.md', 'docs/superpowers/plans/2026-09-21-architecture-a-plan-workspace.md']);
});
test('aborted late source and unavailable remote reader cannot fall back to local content', async () => {
  const controller = new AbortController();
  const port = { read: async (_directory: string, path: string) => { controller.abort(); return path.includes('ROADMAP') ? roadmap : plan; } };
  assert.equal((await readProjectContext(selection, { directory: '/workspace' }, port, controller.signal)).kind, 'stale');
  const unavailable = { read: async () => { throw Object.assign(new Error('offline'), { status: 503 }); } };
  assert.equal((await readProjectContext(selection, { directory: '/workspace' }, unavailable, new AbortController().signal)).kind, 'unavailable');
});
