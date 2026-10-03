import { projectMonitor } from './projection.ts';
import { sameSelection, type MonitorSnapshot, type SelectionKey } from './types.ts';

export type ActionResult = { kind: 'cancelled' | 'stale' | 'sent' | 'denied' | 'unavailable'; reason?: string };
export type InterruptPort = {
  currentSelection(): SelectionKey; freshSnapshot(selection: SelectionKey): Promise<MonitorSnapshot>;
  confirm(target: { id: string; title: string; consequence: string }): Promise<boolean>;
  interrupt(id: string, resume: false): Promise<void>;
};
export type OutputPort = {
  currentSelection(): SelectionKey; freshSnapshot(selection: SelectionKey, signal?: AbortSignal): Promise<MonitorSnapshot>;
  output(directory: string, id: string, cursor: number, limit: number, signal: AbortSignal): Promise<{ output: string; cursor: number; size: number; truncated: boolean }>;
};
export type OutputResult = { kind: 'ready'; selection: SelectionKey; output: string; cursor: number; size: number; truncated: boolean; readAt: number } | { kind: 'stale' | 'denied' | 'unavailable'; reason?: string };
const pending = new WeakMap<InterruptPort, Set<string>>();
const failure = (error: unknown): { kind: 'denied' | 'unavailable'; reason: string } => ({ kind: error instanceof Error && 'status' in error && (error.status === 401 || error.status === 403) ? 'denied' : 'unavailable', reason: 'native-operation-failed' });

export async function interruptSession(targetID: string, origin: SelectionKey, port: InterruptPort): Promise<ActionResult> {
  const active = pending.get(port) ?? new Set<string>(); pending.set(port, active);
  if (active.has(targetID)) return { kind: 'cancelled' };
  active.add(targetID);
  const eligible = async () => {
    if (!sameSelection(origin, port.currentSelection())) return undefined;
    const snapshot = await port.freshSnapshot(origin);
    if (!sameSelection(origin, snapshot.selection) || !sameSelection(origin, port.currentSelection()) || snapshot.activity.kind !== 'ready' || snapshot.sessions.kind !== 'ready') return undefined;
    const view = projectMonitor(snapshot);
    if (!view.familyIDs.has(targetID) || !snapshot.activity.value.has(targetID)) return undefined;
    return snapshot.sessions.value.find(row => row.id === targetID);
  };
  try {
    const target = await eligible();
    if (!target) return { kind: 'stale' };
    if (!await port.confirm({ id: target.id, title: target.title ?? target.id, consequence: 'Stops this session/tool; does not undo files or project data.' })) return { kind: 'cancelled' };
    if (!await eligible()) return { kind: 'stale' };
    await port.interrupt(targetID, false);
    return { kind: 'sent' };
  } catch (error) { return failure(error); }
  finally { active.delete(targetID); }
}

export async function readOwnedOutput(shellID: string, origin: SelectionKey, port: OutputPort, signal: AbortSignal): Promise<OutputResult> {
  try {
    if (signal.aborted || !sameSelection(origin, port.currentSelection())) return { kind: 'stale' };
    const snapshot = await port.freshSnapshot(origin, signal);
    if (signal.aborted || !sameSelection(origin, port.currentSelection()) || !sameSelection(snapshot.selection, origin) || !projectMonitor(snapshot).shells.some(row => row.id === shellID)) return { kind: 'stale' };
    const result = await port.output(origin.directory, shellID, 0, 8192, signal);
    if (signal.aborted || !sameSelection(origin, port.currentSelection())) return { kind: 'stale' };
    const bytes = new TextEncoder().encode(result.output);
    const bounded = new TextDecoder('utf-8', { fatal: false }).decode(bytes.subarray(0, 8192)).replace(/\uFFFD$/, '');
    const output = bounded.replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, '').replace(/[\u0000-\u0008\u000b-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/g, '');
    return { kind: 'ready', selection: origin, output, cursor: result.cursor, size: result.size, truncated: result.truncated || bytes.length > 8192, readAt: Date.now() };
  } catch (error) { return failure(error); }
}

export function createOutputView(port: OutputPort, publish: (result: OutputResult) => void) {
  let controller: AbortController | undefined;
  const close = () => { controller?.abort(); controller = undefined; };
  return {
    close,
    async open(id: string, origin: SelectionKey) {
      close(); const request = new AbortController(); controller = request;
      const result = await readOwnedOutput(id, origin, port, request.signal);
      if (controller === request && !request.signal.aborted && sameSelection(origin, port.currentSelection())) publish(result);
    },
  };
}
