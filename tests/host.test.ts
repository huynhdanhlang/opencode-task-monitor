import test from 'node:test';
import assert from 'node:assert/strict';
import { createMonitorHost } from '../host.ts';
import { snapshot } from './fixtures.ts';
import { projectMonitor } from '../projection.ts';
test('an initial failed read becomes unavailable rather than perpetual loading', async () => {
  const host=createMonitorHost({changed(){},snapshot:async()=>{throw new Error('initial read failed');}});
  host.select(snapshot().selection);await host.refresh();
  assert.equal(projectMonitor(host.current()!).state,'unavailable');host.dispose();
});
test('limits plugin reads to two and deduplicates refresh for the same selection', async () => {
  let running = 0, maximum = 0, requests = 0;
  const host = createMonitorHost({ changed() {}, snapshot: async (key, signal, read) => {
    requests++;
    await Promise.all(Array.from({length:6},()=>read(async()=>{ running++;maximum=Math.max(maximum,running);await new Promise(r=>setTimeout(r,2));running--; },signal)));
    return { ...snapshot(), selection: key };
  } });
  const key = snapshot().selection;
  host.select(key); await Promise.all([host.refresh(),host.refresh()]);
  assert.equal(maximum,2); assert.equal(requests,1); assert.equal(host.current()?.selection.sessionID,'root'); host.dispose();
});
test('late previous-selection reads cannot replace the current view', async () => {
  let old!:()=>void;
  const host = createMonitorHost({ changed() {}, snapshot: async key => {
    if(key.revision===1)await new Promise<void>(r=>{old=r;});
    return {...snapshot(),selection:key};
  } });
  host.select(snapshot().selection);
  host.select({...snapshot().selection,sessionID:'next',revision:2});
  await host.refresh(); old(); await new Promise(r=>setTimeout(r,0));
  assert.equal(host.current()?.selection.sessionID,'next'); host.dispose();
});
test('terminal-turn context refresh is deduplicated and disposal suppresses future work', async () => {
  let contexts=0;
  const host=createMonitorHost({changed(){},snapshot:async key=>({...snapshot(),selection:key}),context:async key=>{contexts++;return {kind:'unmatched',selection:key};}});
  host.select(snapshot().selection);await host.refresh();
  await host.turn('turn-1');await host.turn('turn-1');
  assert.equal(contexts,2);
  host.dispose();await host.turn('turn-2');await host.refresh();assert.equal(contexts,2);
});
test('a failed refresh is visibly stale with no interruption authority', async () => {
  let fail=false;
  const host=createMonitorHost({changed(){},snapshot:async key=>{if(fail)throw new Error('offline');return {...snapshot(),selection:key};}});
  host.select(snapshot().selection);await host.refresh();fail=true;await host.refresh();
  assert.equal(host.current()?.activity.kind,'stale');host.dispose();
});
test('activity refresh never rereads task documents',async()=>{
  let documents=0;
  const host=createMonitorHost({changed(){},snapshot:async key=>({...snapshot(),selection:key}),checklist:async key=>{documents++;return {kind:'unavailable',selection:key};}});
  host.select(snapshot().selection);await host.refresh();await host.refresh(false);
  assert.equal(documents,1);host.dispose();
});
test('a terminal turn arriving during activity read still refreshes the checklist',async()=>{
  let documents=0,release:()=>void=()=>{};let hold=false;
  const host=createMonitorHost({changed(){},snapshot:async key=>{if(hold)await new Promise<void>(r=>release=r);return {...snapshot(),selection:key};},checklist:async key=>{documents++;return {kind:'unavailable',selection:key};}});
  host.select(snapshot().selection);await host.refresh();hold=true;
  const activity=host.refresh(false);const turn=host.turn('finished-turn');release();hold=false;
  await activity;await turn;
  assert.equal(documents,2);host.dispose();
});
test('terminal event during document read publishes a trailing current snapshot',async()=>{
  let hold=false,release:()=>void=()=>{};let active=true,reads=0;
  const host=createMonitorHost({changed(){},snapshot:async key=>{reads++;return {...snapshot(),selection:key,activity:{kind:'ready',value:new Set(active?['root']:[])}};},context:async key=>{if(hold)await new Promise<void>(r=>release=r);return {kind:'unmatched',selection:key};}});
  host.select(snapshot().selection);await host.refresh();hold=true;const refresh=host.refresh();await Promise.resolve();await Promise.resolve();
  active=false;const turn=host.turn('terminal');hold=false;release();await refresh;await turn;
  assert.equal(projectMonitor(host.current()!).state,'inactive');assert.equal(reads,3);host.dispose();
});
test('leaving the native session cancels its reads and clears all projections',async()=>{
  let signal!:AbortSignal;
  const host=createMonitorHost({changed(){},snapshot:async(key,s)=>{signal=s;return {...snapshot(),selection:key};}});
  host.select(snapshot().selection);await host.refresh();host.clear();
  assert.equal(signal.aborted,true);assert.equal(host.current(),undefined);assert.equal(host.selection(),undefined);host.dispose();
});
test('owned output shares the same read budget with native refresh',async()=>{
  let active=0,max=0;
  const work=async()=>{active++;max=Math.max(max,active);await new Promise(r=>setTimeout(r,2));active--;return 0;};
  const host=createMonitorHost({changed(){},snapshot:async(key,s,read)=>{await Promise.all([read(work,s),read(work,s)]);return {...snapshot(),selection:key};}});
  host.select(snapshot().selection);await Promise.all([host.refresh(),host.read(work,new AbortController().signal)]);assert.equal(max,2);host.dispose();
});
