import type { DocumentPort } from './project-context.ts';
import { SOURCE_LIMIT } from './project-context.ts';
import type { SelectionKey } from './types.ts';
import { withoutFences } from './markdown.ts';
export type TaskItem = { number: number; label: string; state: 'done' | 'active' | 'pending' };
export type PlanRef = { directory: string; path: string };
export type ChecklistResult = { kind: 'ready'; selection: SelectionKey; ref: PlanRef; items: TaskItem[]; readAt: number } | { kind: 'unavailable' | 'stale'; selection: SelectionKey };
export function parseTaskChecklist(bytes: Uint8Array): TaskItem[] {
  if (bytes.byteLength > SOURCE_LIMIT) throw new Error('plan-size-limit');
  const text = withoutFences(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  const items = [...text.matchAll(/^#{2,3} Task (\d+):\s*(.+)$/gm)].map(m => ({ number: Number(m[1]), label: m[2].trim(), state: 'pending' as TaskItem['state'] }));
  if (!items.length || new Set(items.map(i => i.number)).size !== items.length) throw new Error('plan-format-unavailable');
  for (const item of items) {
    const states = [...text.matchAll(new RegExp(`^- \\[([ xX-])\\] Task ${item.number} (?:complete|in progress)[^\\n]*$`, 'gm'))];
    if (states.length > 1) throw new Error('ambiguous-task-summary');
    const mark = states[0]?.[1];
    item.state = mark?.toLowerCase() === 'x' ? 'done' : mark === '-' ? 'active' : 'pending';
  }
  return items;
}
export async function readTaskChecklist(selection: SelectionKey, ref: PlanRef, directories: readonly string[], port: DocumentPort, signal: AbortSignal): Promise<ChecklistResult> {
  if (!directories.includes(ref.directory) || !/^docs\/superpowers\/plans\/[\w.-]+\.md$/.test(ref.path)) return { kind: 'unavailable', selection };
  try {
    if (signal.aborted) return { kind: 'stale', selection };
    const bytes = await port.read(ref.directory, ref.path, signal);
    if (signal.aborted) return { kind: 'stale', selection };
    return { kind: 'ready', selection, ref, items: parseTaskChecklist(bytes), readAt: Date.now() };
  } catch { return { kind: signal.aborted ? 'stale' : 'unavailable', selection }; }
}
