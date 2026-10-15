// Background render of passed segments.
// Engines with a frame cache (render.mjs --frames) declare production.json "prerender": { cwd, cmd with {start} {end} }.
// When a segment passes review its final frames are rendered in the background, one segment at a time per project (they
// share out/frames/manifest.json), so assembly only redraws what changed afterwards. A real run spent 29 minutes
// re-rendering all 732 frames at assembly. The processes are tool processes (runner.ts): Cancel stops them too.
import type { ChildProcess } from 'node:child_process';
import { join } from 'node:path';
import { killTree, spawnTool } from './runner.ts';
import { dirOf, load, log, readJSON } from './store.ts';
import type { Plan } from '../shared/types.ts';
import type { Chunk, Production } from './types.ts';

const queue = new Map<string, Promise<void>>(), procs = new Map<string, Set<ChildProcess>>();
const MAX_MS = (seconds: number) => Math.max(10 * 60e3, seconds * 24 * 6e3);   // ~6 s a frame at worst, never under 10 min
const ASSEMBLY_WAIT_MS = +(process.env.PRERENDER_WAIT_MS || 10 * 60e3);   // assembly waits this long for background renders, then stops them and renders what's missing itself
// Projects whose background renders were stopped: renders already queued behind the stopped one must not start later
// and write out/frames while assembly renders there too. Cleared when production (re)starts.
const stopped = new Set<string>();

export function resetPrerenders(id: string) { stopped.delete(id); }
export function stopPrerenders(id: string) { stopped.add(id); for (const p of procs.get(id) || []) killTree(p); queue.delete(id); }
export async function waitPrerenders(id: string, maxMs = ASSEMBLY_WAIT_MS) {
  const q = queue.get(id); if (!q) return;
  let timer: NodeJS.Timeout | undefined;
  const late = await Promise.race([q.then(() => false), new Promise<boolean>((r) => { timer = setTimeout(() => r(true), maxMs); })]);
  clearTimeout(timer);
  if (late) { log(id, { type: 'error', text: `背景渲染超過 ${Math.round(maxMs / 60e3)} 分鐘，先停掉，組裝時補渲` }); stopPrerenders(id); }
}
export function prerender(id: string, c: Chunk) {
  const d = dirOf(id), pr = (readJSON<Production>(join(d, 'build', 'production.json')) || {}).prerender as { cwd?: string; cmd?: string; args?: string[] } | undefined;
  if (!pr?.cmd && !pr?.args?.length) return;
  type S = { id?: string; start_s?: number; end_s?: number };
  const mine = ((readJSON<Plan>(join(d, 'plan.json'))?.shots || []) as S[]).filter((s) => s.id && c.shots.includes(s.id) && s.start_s != null && s.end_s != null);
  if (!mine.length) return;
  const a = Math.min(...mine.map((s) => s.start_s!)), b = Math.max(...mine.map((s) => s.end_s!));
  // "args": ["node", "render.mjs", …] keeps arguments with spaces intact; "cmd" is split on whitespace
  const fill = (x: string) => x.replace('{start}', a.toFixed(3)).replace('{end}', b.toFixed(3));
  const [bin, ...args] = pr.args?.length ? pr.args.map(fill) : fill(pr.cmd!).split(/\s+/);
  const run = () => new Promise<void>((resolve) => {
    if (stopped.has(id) || load(id).stage === 'error') return resolve();   // stopped, cancelled or failed meanwhile
    log(id, { type: 'tool', name: 'prerender', detail: `${c.id} ${a.toFixed(2)}–${b.toFixed(2)} s: ${bin} ${args.join(' ')}` });
    const t0 = Date.now(), p = spawnTool(id, bin, args, { cwd: join(d, pr.cwd || 'build'), env: process.env, stdio: 'ignore' });
    const set = procs.get(id) || new Set(); set.add(p); procs.set(id, set);
    // a render that never exits must not hold the queue (seen: one sat 7 hours after finishing its frames)
    const timer = setTimeout(() => killTree(p), MAX_MS(b - a)); timer.unref();
    let ended = false;
    const done = (ok: boolean) => { if (ended) return; ended = true; clearTimeout(timer); set.delete(p); log(id, { type: ok ? 'text' : 'error', text: `背景渲染 ${c.id}：${ok ? `完成（${Math.round((Date.now() - t0) / 1000)} s）` : '失敗（組裝時會重渲）'}` }); resolve(); };
    p.on('error', () => done(false)); p.on('close', (code) => done(code === 0));
  });
  queue.set(id, (queue.get(id) || Promise.resolve()).then(run));
}
