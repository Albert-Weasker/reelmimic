// Agent outputs are checked, not just timestamped. A step is done when its files were written AND the JSON ones parse
// and have the shape the orchestrator reads. Before this, a critique.json with a trailing comma was read as {} — no
// must-fix items — and the film was delivered as "passed"; a broken production.json meant no segments, so nothing was
// built and the job still reached "done" (both reproduced in pipeline.test.ts).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export interface OutputProblem { file: string; problem: string }

type Check = (v: unknown) => string | null;
const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const object: Check = (v) => (isObj(v) ? null : 'must be a JSON object { … }');
const listOf = (key: string): Check => (v) => object(v) ?? (v === null || (isObj(v) && (v[key] === undefined || Array.isArray(v[key]))) ? null : `"${key}" must be a list`);

// Only the shape the orchestrator relies on; everything else about a file is the agents' contract (CONTRACT.md).
const SHAPES: [RegExp, Check][] = [
  [/(^|\/)plan\.json$/, object],
  [/(^|\/)production\.json$/, (v) => object(v) ?? (isObj(v) && Array.isArray(v.chunks) ? null : '"chunks" must be a list of segments')],
  [/(^|\/)critique\.json$/, listOf('must_fix')],
  [/review(_[^/]*)?\.json$/, (v) => object(v) ?? listOf('issues')(v) ?? listOf('shots')(v)],
  [/fixes(_[^/]*)?\.json$/, (v) => (Array.isArray(v) || (isObj(v) && Array.isArray(v.fixes)) ? null : 'must be a list of fixes [ … ] (or { "fixes": [ … ] })')],
];

/** JSON text as the orchestrator reads it: a UTF-8 byte-order mark (some Windows tools write one) is not an error. */
export const parseJSON = (text: string): unknown => JSON.parse(text.replace(/^\uFEFF/, ''));

/** Problems with the .json files among `files` (paths relative to dir); files that do not exist are not checked here. */
export function checkOutputs(dir: string, files: string[]): OutputProblem[] {
  const out: OutputProblem[] = [];
  for (const f of files.filter((x) => x.endsWith('.json'))) {
    let text: string;
    try { text = readFileSync(join(dir, f), 'utf8'); } catch { continue; }
    let v: unknown;
    try { v = parseJSON(text); } catch (e) { out.push({ file: f, problem: `not valid JSON (${(e as Error).message.slice(0, 160)})` }); continue; }
    const shape = SHAPES.find(([re]) => re.test(f))?.[1];
    const problem = shape?.(v);
    if (problem) out.push({ file: f, problem });
  }
  return out;
}

/** The turn that asks the same agent (same conversation, so it knows what it meant) to repair its files. */
export function repairPrompt(projectDir: string, problems: OutputProblem[]): string {
  return `## 步驟：修正輸出檔的 JSON
專案資料夾：${projectDir}（以下路徑相對於它）
你剛才這一步寫的檔案，系統讀不懂。只修正這些檔案，內容照你原本要表達的意思，不要改其他任何檔案：
${problems.map((p) => `- ${p.file}：${p.problem}`).join('\n')}
寫成標準 JSON：不能有註解、結尾逗號、單引號或 NaN；最外層的型態照 ${'.claude/skills/video-clone'}/CONTRACT.md。改完用 python -c "import json;json.load(open(r'<檔案>',encoding='utf-8'))" 自己確認每個都讀得出來。最後用一行回報。`;
}
