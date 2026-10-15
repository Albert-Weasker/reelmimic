// One flow per project. Every entry point that does work (start, approve, retry, resume, accept, a note that triggers a
// replan or revise) runs inside run(): a second one is refused while the first is going, and cancel()/stopAll() reach
// everything the flow started — the agent turns (through the run's signal) and every tool process (whole process tree).
import { spawn, spawnSync, type ChildProcess, type SpawnOptions } from 'node:child_process';

const IS_WIN = process.platform === 'win32';
const runs = new Map<string, AbortController>();
const kids = new Map<string, Set<ChildProcess>>();

export class Busy extends Error { code = 409; constructor() { super('agent 正在工作中，請等這一輪完成'); } }

export const active = (id: string) => runs.has(id);
export function run<T>(id: string, fn: () => Promise<T>): Promise<T> {
  if (runs.has(id)) return Promise.reject(new Busy());
  runs.set(id, new AbortController());
  return fn().finally(() => runs.delete(id));
}
// The signal of the flow running for this project; turns and tools started outside a flow have nothing to cancel them.
const NEVER = new AbortController().signal;
export const signalOf = (id: string) => runs.get(id)?.signal ?? NEVER;
export const aborted = (id: string) => !!runs.get(id)?.signal.aborted;

// The CLI or tool and everything it started (ffmpeg, Chrome, yt-dlp…). POSIX: the child leads its own process group.
export function killTree(child: ChildProcess) {
  if (child.pid == null || child.exitCode != null) return;
  try {
    if (IS_WIN) spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F']);
    else process.kill(-child.pid, 'SIGTERM');
  } catch { try { child.kill('SIGTERM'); } catch {} }
}
export const treeOpts: { detached?: boolean } = IS_WIN ? {} : { detached: true };

// A tool process for this project (analyze.py, align_lyrics.py, background renders): stopped by cancel() and stopAll()
// like the agents. stdout/stderr are piped unless opts.stdio says otherwise.
export function spawnTool(id: string, cmd: string, args: string[], opts: SpawnOptions = {}) {
  const child = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'], ...opts, ...treeOpts });
  if (!kids.has(id)) kids.set(id, new Set());
  kids.get(id)!.add(child);
  const forget = () => kids.get(id)?.delete(child);
  child.on('close', forget); child.on('error', forget);
  if (signalOf(id).aborted) killTree(child);
  return child as ChildProcess & { stdout: NonNullable<ChildProcess['stdout']>; stderr: NonNullable<ChildProcess['stderr']> };
}

export function cancel(id: string) { runs.get(id)?.abort(); for (const c of kids.get(id) || []) killTree(c); }
export function stopAll() { for (const id of new Set([...runs.keys(), ...kids.keys()])) cancel(id); }
