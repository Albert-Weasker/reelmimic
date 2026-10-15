// The final panel: a fresh critic looks only at what spans segments (seams, continuity, pacing, captions, the climaxes
// against the reference) and verifies every earlier fix ⇄ the director revises. finalRounds automatic revises, a few more
// while the list is short and shrinking; anything left after that is the user's call.
import { join } from 'node:path';
import { reviewFix } from './review.ts';
import { L, chat, collectNeeds, dirOf, load, now, pipe, readJSON, rounds, setStage, update } from './store.ts';
import { step } from './turn.ts';
import type { Critique } from './types.ts';

type MustFix = NonNullable<Critique['must_fix']>;

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
      // Past the limit, keep going while the list is short (≤ 2) and still shrinking, up to 3 extra rounds: a real run went
      // 8 → 3 → 2 → 1 and stopped with its last, most visible defect unfixed. A list that stops shrinking stops the loop.
      converging = must.length <= 2 && must.length < prevMust && round <= rounds(id).finalRounds + 3;
      prevMust = must.length;
      return must;
    },
    verdict: (must) => (must.length ? 'fix' : 'passed'),
    limit: () => (converging ? Infinity : rounds(id).finalRounds + 1),   // n automatic revises → up to n + 1 reviews
    fix: async (must, round) => {
      const msg = must.map((m, i) => `${i + 1}. [${m.shot || '全片'}${m.time != null ? ' ' + m.time + 's' : ''}] ${m.issue}${m.fix ? ' → 建議：' + m.fix : ''}`).join('\n');
      chat(id, 'system', L(id, `評審第 ${total} 輪：${must.length} 項必修，交回導演（每項要附修改前後對照）`, `Final review round ${total}: ${must.length} must-fix item${must.length > 1 ? 's' : ''}, sent back to the director (each fix needs before/after proof)`));
      return (await step(id, 'revising', 'revise', { message: msg, round }, ['out/video.mp4', 'out/check/fixes.json'])) ? 'ok' : 'error';
    },
  });
  if (end === 'error') return;   // step() already stopped the job with the reason
  if (end === 'passed') {
    chat(id, 'system', needs ? L(id, '評審：導演能修的都過了，剩下需要你提供的項目', 'Final review: everything the director can fix is done. What is left needs your input') : L(id, `評審通過（第 ${total} 輪）`, `Final review passed (round ${total})`));
    setStage(id, needs ? 'needs_input' : 'done');
    return;
  }
  const n = last!.length;
  chat(id, 'system', L(id, `評審仍有 ${n} 項必修，已達自動修改上限，請你決定`, `The final review still has ${n} must-fix item${n > 1 ? 's' : ''} and the automatic fix limit is reached. Please decide`));
  setStage(id, 'done');
}
