import type { DisplayState, MonitorSnapshot, MonitorView, SessionRecord } from './types.ts';

export function safeLabel(text: string): string {
  return text.replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, '').replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ').replace(/[\u202a-\u202e\u2066-\u2069]/g, '').replace(/\s+/g, ' ').trim();
}

function family(records: readonly SessionRecord[], selectedID: string): Set<string> {
  const byID = new Map(records.map(row => [row.id, row]));
  const selected = byID.get(selectedID);
  if (!selected) return new Set();
  const seen = new Set<string>();
  let root = selected;
  while (root.parentID) {
    if (seen.has(root.id)) return new Set();
    seen.add(root.id);
    const parent = byID.get(root.parentID);
    if (!parent) break;
    root = parent;
  }
  const result = new Set([root.id]);
  // Fixed-point links are bounded by the number of loaded native records.
  for (let pass = 0; pass < records.length; pass++) {
    let added = false;
    for (const row of records) {
      if (!result.has(row.id) && row.parentID && result.has(row.parentID)) { result.add(row.id); added = true; }
    }
    if (!added) break;
  }
  return result;
}

export function projectMonitor(input: MonitorSnapshot): MonitorView {
  const records = input.sessions.kind === 'ready' ? input.sessions.value : [];
  const selected = records.find(row => row.id === input.selection.sessionID && row.location.directory === input.selection.directory);
  const familyIDs = selected ? family(records, selected.id) : new Set<string>();
  const active = input.activity.kind === 'ready' ? input.activity.value : new Set<string>();
  const attention = input.requests.kind === 'ready' ? input.requests.value.filter(row => familyIDs.has(row.sessionID)) : [];
  const ownAttention = attention.filter(row => row.sessionID === selected?.id);
  let state: DisplayState;
  if (input.sessions.kind !== 'ready') state = input.sessions.kind;
  else if (!selected || !familyIDs.size) state = 'unavailable';
  else if (input.activity.kind !== 'ready') state = input.activity.kind;
  else if (ownAttention.some(row => row.kind === 'permission')) state = 'waiting-permission';
  else if (ownAttention.length) state = 'waiting-input';
  else if (active.has(selected.id)) state = 'running';
  else state = selected.outcome ?? 'inactive';
  const children = records.filter(row => familyIDs.has(row.id) && row.id !== selected?.id).sort((a, b) => Number(active.has(b.id)) - Number(active.has(a.id)) || b.time.updated - a.time.updated).slice(0, 8);
  const shells = input.shells.kind === 'ready' && input.shellDirectory === input.selection.directory ? input.shells.value.filter(row => typeof row.metadata.sessionID === 'string' && familyIDs.has(row.metadata.sessionID)).sort((a, b) => Number(b.status === 'running') - Number(a.status === 'running') || b.time.started - a.time.started).slice(0, 8) : [];
  const currentTool = input.tools.kind === 'ready' ? [...input.tools.value].filter(row => row.sessionID === selected?.id && (row.status === 'running' || row.status === 'streaming')).sort((a, b) => b.created - a.created)[0] : undefined;
  return {
    state, title: safeLabel(selected?.title ?? input.selection.sessionID), familyIDs, children, shells,
    runningChildren: children.filter(row => active.has(row.id)), runningShells: shells.filter(row => row.status === 'running'),
    attention: attention.slice(0, 8), attentionCount: attention.length, attentionKnown: input.requests.kind === 'ready',
    complete: input.complete, currentTool, canInterrupt: !!selected && !!familyIDs.size && input.activity.kind === 'ready' && active.has(selected.id) && state !== 'stale',
    queued: input.queued.kind === 'ready' ? input.queued.value : undefined,
  };
}
