import type { SelectionKey } from './types.ts';
import { withoutFences } from './markdown.ts';

export const SOURCE_LIMIT = 128 * 1024;
export const CHECKPOINT_LIMIT = 24 * 1024;
export const SOURCES = ['docs/ROADMAP_HANDOFF.md', 'docs/superpowers/plans/2026-09-21-architecture-a-plan-workspace.md'] as const;
export type ProjectAdapter = { directory: string };
export type DocumentPort = { read(directory: string, path: string, signal: AbortSignal): Promise<Uint8Array> };
export type ProjectSections = { nextAction: string; checkpoint: string; paths: typeof SOURCES };
export type ProjectContextResult = { kind: 'ready'; selection: SelectionKey; value: ProjectSections; readAt: number } | { kind: 'unmatched' | 'stale' | 'denied' | 'unavailable'; selection: SelectionKey; reason?: string };

function decode(bytes: Uint8Array): string {
  if (bytes.byteLength > SOURCE_LIMIT) throw new Error('source-size-limit');
  return withoutFences(new TextDecoder('utf-8', { fatal: true }).decode(bytes).replace(/\r\n/g, '\n'));
}
function section(text: string, heading: RegExp): string {
  const lines = text.split('\n');
  const matches = lines.map((line, n) => heading.test(line) ? n : -1).filter(n => n >= 0);
  if (matches.length !== 1) throw new Error('source-format-unavailable');
  const start = matches[0] + 1;
  const next = lines.findIndex((line, n) => n >= start && /^## /.test(line));
  return lines.slice(start, next < 0 ? undefined : next).join('\n').trim();
}
export function parseProjectContext(roadmap: Uint8Array, plan: Uint8Array): ProjectSections {
  const nextAction = section(decode(roadmap), /^## Next exact action\s*$/).split(/\n\s*\n/)[0].trim();
  const checkpoint = section(decode(plan), /^## Current checkpoint(?:\s|$)/);
  if (!nextAction || !checkpoint) throw new Error('source-format-unavailable');
  if (new TextEncoder().encode(checkpoint).byteLength > CHECKPOINT_LIMIT) throw new Error('checkpoint-size-limit');
  return { nextAction, checkpoint, paths: SOURCES };
}
export async function readProjectContext(selection: SelectionKey, adapter: ProjectAdapter, port: DocumentPort, signal: AbortSignal): Promise<ProjectContextResult> {
  if (selection.directory !== adapter.directory) return { kind: 'unmatched', selection };
  try {
    if (signal.aborted) return { kind: 'stale', selection };
    // Sequential reads also respect the plugin-wide two-read budget.
    const roadmap = await port.read(selection.directory, SOURCES[0], signal);
    if (signal.aborted) return { kind: 'stale', selection };
    const plan = await port.read(selection.directory, SOURCES[1], signal);
    if (signal.aborted) return { kind: 'stale', selection };
    return { kind: 'ready', selection, value: parseProjectContext(roadmap, plan), readAt: Date.now() };
  } catch (error) {
    if (signal.aborted) return { kind: 'stale', selection };
    const status = error instanceof Error && 'status' in error ? error.status : undefined;
    return { kind: status === 401 || status === 403 ? 'denied' : 'unavailable', selection, reason: error instanceof Error ? error.message : 'source-unavailable' };
  }
}
