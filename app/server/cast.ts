// The cast gate: every character is reviewed and fixed before any shot review counts.
// Several characters, each in its own file → one reviewer + fixer pair per character, all at once; then one line-up check.
// One character, or everything in one file → the serial gate.
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { blockerFree, reviewFix, sharedItems, type LoopEnd } from './review.ts';
import { L, chat, collectNeeds, dirOf, pause, pipe, preset, readJSON, rounds, setStage } from './store.ts';
import { fail, turn, type TurnResult } from './turn.ts';
import type { CastCharProgress, Pipeline, Review } from '../shared/types.ts';
import type { CastMember, Production, SharedItem } from './types.ts';

type CastResult = 'error' | 'needs' | 'passed' | 'failed' | 'shared';
const RESULT: Record<LoopEnd, CastResult> = { error: 'error', needs: 'needs', passed: 'passed', limit: 'failed', handoff: 'shared' };
const STATE: Record<LoopEnd, CastCharProgress['state']> = { error: 'error', needs: 'needs_user', passed: 'passed', limit: 'failed', handoff: 'waiting_shared' };

export async function castGate(id: string, prev: Pipeline): Promise<boolean> {
  const d = dirOf(id), prod = readJSON<Production>(join(d, 'build', 'production.json')) || {};
  const chars = (prod.characters || []).filter((c) => c && c.id && c.file && c.sheet);
  const files = new Set(chars.map((c) => c.file));
  const parallel = chars.length > 1 && files.size === chars.length && chars.every((c) => existsSync(join(d, c.sheet)));
  if (prev.cast?.pass) return true;
  if (!(prod.characters || []).length) { pipe(id, (p) => { p.cast = { round: 0, pass: true, state: 'passed' }; }); return true; }   // no cast: nothing to review
  if (!parallel) return castSerial(id, prev);
  const setC = (cid: string, v: Partial<CastCharProgress>) => pipe(id, (p) => { const cast = p.cast!; cast.chars = cast.chars || {}; cast.chars[cid] = { ...(cast.chars[cid] ?? { state: 'queued', round: 0 }), ...v }; });
  const keep: Record<string, CastCharProgress> = prev.cast?.mode === 'parallel' ? prev.cast.chars || {} : {};   // resuming: characters that already passed stay passed
  pipe(id, (p) => { p.cast = { round: 0, pass: false, state: 'reviewing', mode: 'parallel', chars: Object.fromEntries(chars.map((c): [string, CastCharProgress] => [c.id, keep[c.id]?.state === 'passed' ? keep[c.id] : { state: 'queued', round: 0 }])) }; });
  chat(id, 'system', L(id, `角色關：${chars.length} 個角色各自由一組審查＋修正同時進行`, `Characters: reviewing and fixing ${chars.length} character${chars.length > 1 ? 's' : ''} in parallel`));
  const shared: SharedItem[] = [];
  let broken = null as TurnResult | null;   // the first agent turn that failed: reported as itself, not as "didn't pass review"
  const one = async (c: CastMember, recheck = false): Promise<CastResult> => {
    const reviewFile = join(d, 'out', 'check', 'cast', `review_${c.id}.json`);
    // resuming a character that stopped at its round limit: its last review is still current, so fix those issues first
    const reuse = !recheck && keep[c.id]?.state === 'failed' && existsSync(reviewFile);   // a re-check after a shared fix always reviews afresh
    const { end, last } = await reviewFix<Review>({
      review: async (round) => {
        setC(c.id, { state: 'reviewing', round });
        if (!(round === 1 && reuse)) {
          const r = await turn(id, 'cast_qa', { round, character: c }, [`out/check/cast/review_${c.id}.json`], { session: 'fresh', who: `cast-qa-${c.id}` });
          if (!r.ok) { broken ??= r; return null; }
        }
        return readJSON<Review>(reviewFile) || {};
      },
      verdict: (rv) => (collectNeeds(id, rv.needs_user, `cast-qa-${c.id}`) ? 'needs' : blockerFree(rv) ? 'passed' : 'fix'),
      limit: () => rounds(id).castRounds + (reuse ? 1 : 0),   // a reused review isn't a round: resuming still gets its fixes
      fix: async (rv, round) => {
        setC(c.id, { state: 'fixing' });
        const f = await turn(id, 'cast_fix', { issues: rv.issues || [], round, character: c, rigFiles: prod.rig_files || [] }, [c.sheet, `out/check/cast/fixes_${c.id}.json`], { session: `cast-${c.id}`, who: `cast-${c.id}` });
        if (!f.ok) { broken ??= f; return 'error'; }
        const sh = sharedItems(readJSON(join(d, 'out', 'check', 'cast', `fixes_${c.id}.json`)));
        if (!sh.length) return 'ok';
        shared.push(...sh.map((x) => ({ ...x, character: c.id })));
        return 'handoff';
      },
    });
    // fast mode: a character at its limit carries on (the issues stay listed; the user can upgrade the mode)
    if (end === 'limit' && !preset(id).pauseAtLimit) { setC(c.id, { state: 'passed', issues: (last?.issues || []).length, acceptedAtLimit: true }); return 'passed'; }
    setC(c.id, end === 'limit' ? { state: 'failed', issues: (last?.issues || []).length } : { state: STATE[end] });
    return RESULT[end];
  };
  let res: CastResult[] = await Promise.all(chars.map((c) => (keep[c.id]?.state === 'passed' ? 'passed' : one(c))));
  if (broken) return fail(id, 'producing', broken);
  if (res.includes('needs')) return pause(id);
  for (let k = 0; shared.length && k < rounds(id).castRounds; k++) {   // skeleton changes: one director turn, then re-check who asked (and anyone it may affect)
    pipe(id, (p) => { p.cast!.state = 'fixing'; });
    const f = await turn(id, 'cast_fix', { issues: [...shared], round: 'shared', shared: true }, ['out/check/cast/sheet.jpg'], { who: 'director' });
    if (!f.ok) return fail(id, 'producing', f);
    shared.length = 0;
    res = await Promise.all(chars.map((c, i) => (res[i] === 'passed' || res[i] === 'shared' ? one(c, true) : res[i])));
    if (broken) return fail(id, 'producing', broken);
    if (res.includes('needs')) return pause(id);
  }
  if (res.some((x) => x !== 'passed')) {
    const names = chars.filter((c, i) => res[i] !== 'passed').map((c) => c.name || c.id), n = rounds(id).castRounds;
    pipe(id, (p) => { p.cast!.state = 'failed'; p.cast!.round = n; });
    chat(id, 'system', L(id, `角色關：${names.join('、')} 審了 ${n} 輪還沒通過，請你看設定圖決定`, `Characters: ${names.join(', ')} still not passing after ${n} rounds. Please check the character sheets and decide`));
    return pause(id);
  }
  // every character passed on its own → one line-up check across them, then the serial gate handles anything it finds
  pipe(id, (p) => { p.cast!.state = 'reviewing'; p.cast!.lineup = true; });
  const r = await turn(id, 'cast_qa', { round: 'lineup', lineup: true }, ['out/check/cast/review.json'], { session: 'fresh', who: 'cast-qa' });
  if (!r.ok) return fail(id, 'producing', r);
  const rv = readJSON<Review>(join(d, 'out', 'check', 'cast', 'review.json')) || {};
  if (collectNeeds(id, rv.needs_user, 'cast-qa')) return pause(id);
  if (blockerFree(rv)) { pipe(id, (p) => { p.cast!.pass = true; p.cast!.state = 'passed'; }); chat(id, 'system', L(id, '角色關通過（每個角色各自通過＋並排檢查）', 'Characters passed (each one on its own, then side by side)')); return true; }
  return castSerial(id, { cast: { round: 0, pass: false } }, rv);
}

// The whole cast as one: one reviewer, the director fixes. firstReview: the line-up check already reviewed, go straight to fixing.
async function castSerial(id: string, prev: Pipeline, firstReview?: Review | null): Promise<boolean> {
  const d = dirOf(id);
  if (prev.cast?.pass) return true;
  pipe(id, (p) => { p.cast = { round: 0, pass: false }; });
  let broken = null as TurnResult | null;
  const { end, round } = await reviewFix<Review>({
    review: async (round) => {
      pipe(id, (p) => { p.cast!.round = round; p.cast!.state = 'reviewing'; });
      if (firstReview) { const rv = firstReview; firstReview = null; return rv; }
      const r = await turn(id, 'cast_qa', { round }, ['out/check/cast/review.json'], { session: 'fresh', who: 'cast-qa' });
      if (!r.ok) { broken = r; return null; }
      return readJSON<Review>(join(d, 'out', 'check', 'cast', 'review.json')) || {};
    },
    verdict: (rv) => (collectNeeds(id, rv.needs_user, 'cast-qa') ? 'needs' : blockerFree(rv) ? 'passed' : 'fix'),
    limit: () => rounds(id).castRounds,
    fix: async (rv, round) => {
      pipe(id, (p) => { p.cast!.state = 'fixing'; });
      const f = await turn(id, 'cast_fix', { issues: rv.issues || [], round }, ['out/check/cast/sheet.jpg', 'out/check/cast/fixes.json'], { who: 'director' });
      if (!f.ok) { broken = f; return 'error'; }
      return 'ok';
    },
  });
  if (end === 'error') return fail(id, 'producing', broken!);
  if (end === 'needs') return pause(id);
  if (end === 'limit' && !preset(id).pauseAtLimit) {
    pipe(id, (p) => { p.cast!.pass = true; p.cast!.state = 'passed'; p.cast!.acceptedAtLimit = true; });
    chat(id, 'system', L(id, `快速模式：角色關審了 ${round} 輪，還有問題沒修，先繼續製作`, `Fast mode: characters had ${round} review rounds with issues left; carrying on`));
    return true;
  }
  if (end === 'limit') {
    pipe(id, (p) => { p.cast!.state = 'failed'; });
    chat(id, 'system', L(id, `角色關 ${round} 輪仍未通過，請你看角色設定圖決定`, `Characters still not passing after ${round} rounds. Please check the character sheets and decide`));
    setStage(id, 'needs_input');
    return false;
  }
  pipe(id, (p) => { p.cast!.pass = true; p.cast!.state = 'passed'; });
  chat(id, 'system', L(id, `角色關通過（第 ${round} 輪）`, `Characters passed (round ${round})`));
  return true;
}
