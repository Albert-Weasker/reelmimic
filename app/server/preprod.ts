// Pre-production: measure the reference (analyze.py), style it (director), then the plan as a small DAG — the director
// writes the plan core, every character (one agent each) and the assets (one agent) are drafted at the same time, then the
// director merges them and paints the style frames with the real cast. Ends in plan_review, waiting for the user.
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { aborted, spawnTool } from './runner.ts';
import { CANCELLED, L, PY, ROOT, SCRIPTS, chat, diskWarning, dirOf, load, log, noPython, readJSON, setStage, update } from './store.ts';
import { step, turn } from './turn.ts';
import type { Plan } from '../shared/types.ts';

function analyze(id: string): Promise<boolean> {
  const j = load(id), d = dirOf(id), src = j.reference.type === 'url' ? j.reference.src : join(d, j.reference.src);
  setStage(id, 'analyzing');
  log(id, { type: 'tool', name: 'analyze.py', detail: j.reference.src });
  return new Promise((resolve) => {
    const p = spawnTool(id, PY, [join(SCRIPTS, 'analyze.py'), src, '--out', join(d, 'analysis')], { cwd: ROOT, env: { ...process.env, PYTHONIOENCODING: 'utf-8' } });
    p.stdout.on('data', (b) => String(b).split('\n').filter(Boolean).forEach((l) => log(id, { type: 'text', text: l })));
    p.stderr.on('data', (b) => { const s = String(b); if (!/Warning|warn\(/i.test(s)) log(id, { type: 'error', text: s.slice(0, 400) }); });
    let done = false;
    const finish = (code: number | null, err?: Error) => {
      if (done) return; done = true;
      const ok = code === 0 && existsSync(join(d, 'analysis', 'report.json'));
      if (!ok) setStage(id, 'error', { failed: 'analyzing', error: err ? noPython(err) : aborted(id) ? L(id, CANCELLED.zh, CANCELLED.en) : 'analyze.py failed' });
      resolve(ok);
    };
    p.on('error', (e) => finish(null, e));   // e.g. Python not found: without this listener the server crashes
    p.on('close', (code) => finish(code));
  });
}

export async function fromAnalysis(id: string) {
  diskWarning(id);
  if (!(await analyze(id))) return;
  await fromStyle(id);
}
const STYLE_OUT = ['analysis/STYLE.md', 'analysis/route.json', 'analysis/peaks.json'];   // peaks: the reference's goosebump moments
export async function fromStyle(id: string) {
  if (!(await step(id, 'styling', 'style', {}, STYLE_OUT, 'styled'))) return;
  await preProduction(id);
}

export async function preProduction(id: string) {
  const d = dirOf(id);
  if (!(await step(id, 'planning', 'plan', {}, ['plan.json', 'STORYBOARD.md']))) return false;
  const plan = readJSON<Plan>(join(d, 'plan.json')) || {};
  const chars = (plan.characters || []).filter((c): c is typeof c & { file: string } => !!(c && c.id && c.file && /^build\//.test(c.file)));
  const needAssets = (plan.assets || []).some((a) => a && a.status === 'to_fetch');
  const work = [
    ...chars.map((c) => turn(id, 'pre_cast', { character: c }, [c.file], { session: `cast-${c.id}`, who: `cast-${c.id}` }).then((r) => ({ what: `角色 ${c.name || c.id}`, ok: r.ok }))),
    ...(needAssets ? [turn(id, 'pre_assets', {}, ['assets/fetched.json'], { session: 'fresh', who: 'assets' }).then((r) => ({ what: '素材', ok: r.ok }))] : []),
  ];
  if (work.length) chat(id, 'system', L(id, `企劃核心完成，${chars.length ? `${chars.length} 個角色` : ''}${chars.length && needAssets ? '和' : ''}${needAssets ? '素材' : ''}同時製作中`,
    `Plan core done. Now drafting ${[chars.length ? `${chars.length} character${chars.length > 1 ? 's' : ''}` : '', needAssets ? 'the assets' : ''].filter(Boolean).join(' and ')} in parallel`));
  const results = await Promise.all(work);   // a failed helper is not fatal: the director finishes that part next
  if (!(await step(id, 'planning', 'plan_frames', { results }, ['plan.json'], 'plan_review'))) return false;
  return flushNotes(id);
}

// Notes the user sent while the plan was being written: folded in with a replan as soon as the plan exists.
export async function flushNotes(id: string): Promise<boolean> {
  const notes = load(id).pendingNotes || [];
  if (!notes.length) return true;
  update(id, (x) => { x.pendingNotes = []; });
  chat(id, 'system', L(id, '把企劃寫作期間你補充的意見修進企劃', 'Adding the notes you sent while the plan was being written'));
  if (!(await step(id, 'replanning', 'replan', { message: notes.join('\n\n') }, ['plan.json'], 'plan_review'))) return false;
  return flushNotes(id);
}
