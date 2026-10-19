// The review → fix loop every gate runs (each character, the cast as a whole, each segment, the final panel): a fresh
// reviewer looks, needs_user items pause, a clean review passes, otherwise the fixer works on what was found — until the
// project's round limit, where the job stops and asks the user instead of looping.
import type { Issue } from '../shared/types.ts';
import type { SharedItem } from './types.ts';

export type LoopEnd = 'passed' | 'needs' | 'limit' | 'error' | 'handoff';
export interface Loop<R> {
  review: (round: number) => Promise<R | null>;                          // null: the review turn failed
  verdict: (r: R, round: number) => 'passed' | 'needs' | 'fix';
  limit: (r: R, round: number) => number;                                 // read every round: a changed setting applies next round
  fix: (r: R, round: number) => Promise<'ok' | 'error' | 'handoff'>;      // handoff: someone else must act first (a shared file)
}
export async function reviewFix<R>(o: Loop<R>): Promise<{ end: LoopEnd; round: number; last: R | null }> {
  for (let round = 1; ; round++) {
    const r = await o.review(round);
    if (r == null) return { end: 'error', round, last: null };
    const v = o.verdict(r, round);
    if (v !== 'fix') return { end: v, round, last: r };
    if (round >= o.limit(r, round)) return { end: 'limit', round, last: r };
    const f = await o.fix(r, round);
    if (f !== 'ok') return { end: f, round, last: r };
  }
}

// A review passes when nothing it lists is a blocker (polish items are handed on, they never hold the line).
// Reviews without severities fall back to their own pass flag.
export function blockerFree(rv: { issues?: Issue[]; pass?: boolean }) {
  const L = rv.issues || [];
  return L.length && L.every((x) => x.severity) ? !L.some((x) => x.severity !== 'polish') : !!rv.pass;
}
// Items in a fixes file the fixer couldn't do alone because they live in a shared file (rig, cast, common assets).
export const sharedItems = (fx: SharedItem[] | { fixes?: SharedItem[] } | null) => (Array.isArray(fx) ? fx : fx?.fixes || []).filter((x) => x && x.status === 'shared');
