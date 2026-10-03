import type { MonitorSnapshot, SessionRecord, ShellRecord } from '../types.ts';

export const session = (id: string, parentID?: string): SessionRecord => ({
  id, parentID, title: id, location: { directory: '/workspace' }, time: { created: 1, updated: 1 },
});
export const shell = (id: string, owner?: string): ShellRecord => ({
  id, status: 'running', cwd: '/workspace', metadata: owner ? { sessionID: owner } : {}, time: { started: 1 },
});
export const snapshot = (overrides: Partial<MonitorSnapshot> = {}): MonitorSnapshot => ({
  selection: { sessionID: 'root', directory: '/workspace', revision: 1 },
  sessions: { kind: 'ready', value: [session('root')] },
  activity: { kind: 'ready', value: new Set(['root']) },
  tools: { kind: 'ready', value: [] },
  requests: { kind: 'ready', value: [] },
  shells: { kind: 'ready', value: [] },
  queued: { kind: 'ready', value: 0 },
  shellDirectory: '/workspace', complete: false, ...overrides,
});
