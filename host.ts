import { sameSelection, type MonitorSnapshot, type SelectionKey } from './types.ts';
import type { ProjectContextResult } from './project-context.ts';
import type { ChecklistResult } from './task-checklist.ts';

export type ReadBudget = <T>(work: () => Promise<T>, signal: AbortSignal) => Promise<T>;
export type MonitorPorts = {
  changed(): void;
  failed?(error: unknown): void;
  snapshot(key: SelectionKey, signal: AbortSignal, read: ReadBudget): Promise<MonitorSnapshot>;
  context?(key: SelectionKey, signal: AbortSignal, read: ReadBudget): Promise<ProjectContextResult>;
  checklist?(key: SelectionKey, signal: AbortSignal, read: ReadBudget): Promise<ChecklistResult | undefined>;
};
export function createMonitorHost(ports: MonitorPorts) {
  let key: SelectionKey | undefined, current: MonitorSnapshot | undefined, context: ProjectContextResult | undefined;
  let controller = new AbortController(), disposed = false, inFlight: Promise<void> | undefined, lastTurn: string | undefined;
  let checklist: ChecklistResult | undefined;
  let refreshFlags: {documents:boolean;again:boolean} | undefined;
  let active = 0;
  const queue: (() => void)[] = [];
  const drain = () => { while (active < 2 && queue.length) queue.shift()?.(); };
  const read: ReadBudget = (work, signal) => new Promise((resolve, reject) => {
    const run = () => {
      if (signal.aborted || disposed) { reject(new DOMException('Read cancelled', 'AbortError')); return; }
      active++;
      Promise.resolve().then(work).then(resolve, reject).finally(() => { active--; drain(); });
    };
    queue.push(run); drain();
  });
  const applicable = (origin: SelectionKey, signal: AbortSignal) => !disposed && !signal.aborted && !!key && sameSelection(key, origin);
  const refresh = (documents = true, trailing = false): Promise<void> => {
    if (disposed || !key) return Promise.resolve();
    if (inFlight) { if (refreshFlags) { if(documents)refreshFlags.documents=true; if(trailing)refreshFlags.again=true; } return inFlight; }
    const flags = {documents,again:false}; refreshFlags = flags;
    const origin = key, signal = controller.signal;
    const pending = (async () => {
      try {
        do {
        flags.again=false;
        const readDocuments=flags.documents;flags.documents=false;
        const next = await ports.snapshot(origin, signal, read);
        if (!applicable(origin, signal)) return;
        current = next; ports.changed();
        if (readDocuments && ports.context) {
          const value = await ports.context(origin, signal, read);
          if (applicable(origin, signal)) { context = value; ports.changed(); }
        }
        if (readDocuments && ports.checklist) {
          const value = await ports.checklist(origin, signal, read);
          if (applicable(origin, signal)) { checklist = value; ports.changed(); }
        }
        } while (flags.again && applicable(origin, signal));
      } catch (error) {
        if (!applicable(origin, signal)) return;
        if (current) current = { ...current, activity: { kind: 'stale', reason: 'native-reader-unavailable' } };
        else current = { selection: origin, sessions: {kind:'unavailable'}, activity:{kind:'unavailable'}, requests:{kind:'unavailable'}, shells:{kind:'unavailable'}, tools:{kind:'unavailable'}, queued:{kind:'unavailable'}, shellDirectory:origin.directory,complete:false };
        ports.failed?.(error);
        ports.changed();
      }
    })();
    inFlight = pending;
    void pending.finally(() => { if (inFlight === pending) inFlight = undefined; });
    return pending;
  };
  return {
    select(next: SelectionKey) {
      if (key && sameSelection(key, next)) return;
      controller.abort(); controller = new AbortController(); key = next; current = undefined; context = undefined; checklist = undefined; inFlight = undefined; lastTurn = undefined;
      ports.changed(); void refresh();
    },
    refresh,
    async turn(id: string) { if (disposed || lastTurn === id) return; lastTurn = id; await refresh(true,true); },
    clear() { controller.abort(); controller=new AbortController();key=undefined;current=undefined;context=undefined;checklist=undefined;inFlight=undefined;lastTurn=undefined;ports.changed(); },
    current: () => current,
    context: () => context,
    checklist: () => checklist,
    selection: () => key,
    read,
    dispose() { disposed = true; controller.abort(); queue.splice(0).forEach(run => run()); current = undefined; context = undefined; },
  };
}
export type MonitorHost = ReturnType<typeof createMonitorHost>;
