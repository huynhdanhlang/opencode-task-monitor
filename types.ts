export type SelectionKey = { sessionID: string; directory: string; revision: number };
export type ReadState<T> = { kind: 'ready'; value: T } | { kind: 'loading' | 'stale' | 'denied' | 'unavailable'; reason?: string; lastKnown?: T };
export type DisplayState = 'loading' | 'inactive' | 'waiting-permission' | 'waiting-input' | 'running' | 'succeeded' | 'failed' | 'interrupted' | 'stale' | 'denied' | 'unavailable';
export type SessionRecord = { id: string; parentID?: string; title?: string; outcome?: 'succeeded' | 'failed' | 'interrupted'; location: { directory: string }; time: { created: number; updated: number; idle?: number }; model?: { providerID: string; id: string; variant?: string } };
export type ShellRecord = { id: string; status: 'running' | 'exited' | 'timeout' | 'killed'; cwd: string; metadata: Record<string, unknown>; time: { started: number; completed?: number } };
export type ToolRecord = { id: string; sessionID: string; name: string; status: 'streaming' | 'running' | 'completed' | 'error'; created: number };
export type RequestRecord = { id: string; sessionID: string; kind: 'permission' | 'question'; label: string };
export type MonitorSnapshot = {
  selection: SelectionKey; sessions: ReadState<readonly SessionRecord[]>; activity: ReadState<ReadonlySet<string>>;
  tools: ReadState<readonly ToolRecord[]>; requests: ReadState<readonly RequestRecord[]>;
  shells: ReadState<readonly ShellRecord[]>; queued: ReadState<number>; shellDirectory: string; complete: boolean;
};
export type MonitorView = {
  state: DisplayState; title: string; familyIDs: ReadonlySet<string>; children: readonly SessionRecord[];
  runningChildren: readonly SessionRecord[]; runningShells: readonly ShellRecord[];
  shells: readonly ShellRecord[]; attention: readonly RequestRecord[]; attentionCount: number; attentionKnown: boolean;
  complete: boolean; currentTool?: ToolRecord; canInterrupt: boolean; queued: number | undefined;
};
export const sameSelection = (a: SelectionKey, b: SelectionKey) => a.sessionID === b.sessionID && a.directory === b.directory && a.revision === b.revision;
