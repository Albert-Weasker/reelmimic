// The final panel: a fresh critic looks only at what spans segments (seams, continuity, pacing, captions, the climaxes
// against the reference) and verifies every earlier fix ⇄ the builders and the director revise. finalRounds automatic
// revises, a few more while the list keeps shrinking (by quality mode); anything left after that is the user's call
// (or, in fast mode, listed with the delivered film).
import { join } from 'node:path';
import { reviewFix } from './review.ts';
import { L, chat, collectNeeds, dirOf, load, now, pipe, preset, readJSON, rounds, setStage, update } from './store.ts';
import { fail, step, turn } from './turn.ts';
import type { Chunk, Critique, Production, ShotEntry } from './types.ts';

type MustFix = NonNullable<Critique['must_fix']>;
type Item = MustFix[number];

// A must-fix item is a segment's when every shot it names is in that one segment.
function splitBySegment(id: string, must: MustFix): { local: Map<Chunk, Item[]>; global: Item[] } {
  const chunks = readJSON<Production>(join(dirOf(id), 'build', 'production.json'))?.chunks || [];
  const local = new Map<Chunk, Item[]>(), global: Item[] = [];
  for (const m of must) {
    const shots = [...new Set(String(m.shot || '').match(/S\d+/g) || [])];
    const owners = new Set(shots.map((s) => chunks.find((c) => c.shots.includes(s))));
    const [owner] = [...owners];
    if (shots.length && owners.size === 1 && owner) local.set(owner, [...(local.get(owner) || []), m]);
    else global.push(m);
  }
  return { local, global };
}

// The items as a builder's per-shot issue list. Shot ids are matched whole: a substring test handed S10's item to S1 too.
export function shotIssues(items: Item[]): ShotEntry[] {
  const named = items.map((m) => ({ m, shots: new Set(String(m.shot || '').match(/S\d+/g) || []) }));
  return [...new Set(named.flatMap((x) => [...x.shots]))]
    .map((sid) => ({ id: sid, issues: named.filter((x) => x.shots.has(sid)).map(({ m }) => ({ issue: `${m.time != null ? `[${m.time}s] ` : ''}${m.issue}`, fix: m.fix })) }));
}

// Segment items go back to the builders who made them, all at once (their conversations still hold how each shot was
// made). Real runs: the director fixing 9–12 items alone was the longest step after approval (14–17 min), and its edits
// to shots it had not built brought back the very defect being fixed in another shot. Returns the fixes files for the
// director's render and evidence, or null when a builder turn failed (the job is stopped with the reason).
async function fixSegments(id: string, local: Map<Chunk, Item[]>, round: number): Promise<string[] | null> {
  if (!local.size) return [];
  const ids = [...local.keys()].map((c) => c.id);
  chat(id, 'system', L(id, `${ids.join('、')} 的必修交回各段的製作 agent 同時修，全片性的交給導演`, `Segment items go back to their builders (${ids.join(', ')}) in parallel; film-wide ones to the director`));
  const results = await Promise.all([...local.entries()].map(async ([c, items]) => {
    const r = await turn(id, 'fix_chunk', { chunk: c, bad: shotIssues(items), round: `final-${round}`, final: true }, [`out/check/shots/${c.id}.fixes.json`], { session: `builder-${c.id}`, who: `builder-${c.id}` });
    return { c, r };
  }));
  const failed = results.find((x) => !x.r.ok);
  if (failed) { fail(id, 'revising', failed.r); return null; }
  return results.map((x) => `out/check/shots/${x.c.id}.fixes.json`);
}

export async function finalPanel(id: string) {
  const d = dirOf(id);
  let needs = 0, total = 0, prevMust = Infinity, converging = false;
  const { end, last } = await reviewFix<MustFix>({
    review: async (round) => {
      pipe(id, (p) => { p.phase = 'final'; p.final = { round }; });
      if (!(await step(id, 'critiquing', 'critique', { round }, ['out/check/critique.json'], null, { session: 'fresh', who: 'critic' }))) return null;
      const c = readJSON<Critique>(join(d, 'out', 'check', 'critique.json')) || {};
      const must = (c.must_fix || []).filter(Boolean);
      // a climax that loses to the reference never passes, even if the critic forgot to list a fix for it
      for (const pk of (c.peaks || []).filter((x) => x?.verdict === 'ref_better'))
        if (!must.some((m) => m.issue.includes(pk.id))) must.push({ shot: pk.id, time: pk.ours?.[0], issue: `高潮 ${pk.id} 輸給參考片：${pk.why || ''}`, fix: `照 ${pk.strip || '高潮對照圖'} 逐格補上參考片爆點的手法，直到不輸參考片` });
      total = (load(id).critiqueRounds || 0) + 1;   // every critic pass since approval (retries and user revisions included)
      update(id, (j) => { j.critiqueRounds = total; j.lastCritique = { pass: !must.length, must: must.length, at: now() }; });
      needs = collectNeeds(id, c.needs_user, 'critic');   // never sent to the director: they wait for the user
      // Past the limit, keep going while the list is clearly shrinking — short (≤ 3) or at most half of the last round's —
      // for a few extra rounds (by quality mode). Real runs went 8 → 3 → 2 → 1 and 9 → 3 and stopped with visible defects
      // (a character teleporting between two frames) unfixed. A list that stops shrinking stops the loop.
      const shrinking = must.length < prevMust && (must.length <= 3 || must.length <= prevMust / 2);
      converging = shrinking && round <= rounds(id).finalRounds + preset(id).converge;
      prevMust = must.length;
      return must;
    },
    verdict: (must) => (must.length ? 'fix' : 'passed'),
    limit: () => (converging ? Infinity : rounds(id).finalRounds + 1),   // n automatic revises → up to n + 1 reviews
    fix: async (must, round) => {
      chat(id, 'system', L(id, `評審第 ${total} 輪：${must.length} 項必修（每項要附修改前後對照）`, `Final review round ${total}: ${must.length} must-fix item${must.length > 1 ? 's' : ''} (each fix needs before/after proof)`));
      setStage(id, 'revising', { error: null, failed: null });
      const { local, global } = splitBySegment(id, must);
      const builderFixes = await fixSegments(id, local, round);
      if (builderFixes === null) return 'error';
      const msg = global.map((m, i) => `${i + 1}. [${m.shot || '全片'}${m.time != null ? ' ' + m.time + 's' : ''}] ${m.issue}${m.fix ? ' → 建議：' + m.fix : ''}`).join('\n');
      return (await step(id, 'revising', 'revise', { message: msg, round, builderFixes }, ['out/video.mp4', 'out/check/fixes.json'])) ? 'ok' : 'error';
    },
  });
  if (end === 'error') return;   // step() / fixSegments() already stopped the job with the reason
  if (end === 'passed') {
    chat(id, 'system', needs ? L(id, '評審：導演能修的都過了，剩下需要你提供的項目', 'Final review: everything the director can fix is done. What is left needs your input') : L(id, `評審通過（第 ${total} 輪）`, `Final review passed (round ${total})`));
    setStage(id, needs ? 'needs_input' : 'done');
    return;
  }
  const n = last!.length;
  chat(id, 'system', preset(id).pauseAtLimit
    ? L(id, `評審仍有 ${n} 項必修，已達自動修改上限，請你決定`, `The final review still has ${n} must-fix item${n > 1 ? 's' : ''} and the automatic fix limit is reached. Please decide`)
    : L(id, `快速模式交件：評審還列了 ${n} 項可以再修（在評審報告裡）。想修掉就把品質升級，會從這支片接著修。`, `Fast mode delivered: the final review lists ${n} more item${n > 1 ? 's' : ''} to fix (see the review). Upgrade the quality to fix them, starting from this film.`));
  setStage(id, 'done');
}
