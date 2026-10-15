// The JSON files agents write and the server decides on (CONTRACT.md), checked when the turn that wrote them ends.
// Only the fields the server reads are checked, and extra fields are fine. A broken file goes back to the agent that wrote it
// (turn.ts) instead of being read as {} — an empty review would fail the gate, an empty plan would build nothing.
type Check = (v: unknown, at: string) => string[];

const kind = (v: unknown) => (v === null ? 'null' : Array.isArray(v) ? 'array' : typeof v);
const is = (want: string): Check => (v, at) => (kind(v) === want ? [] : [`${at}: expected ${want}, got ${kind(v)}`]);
const str = is('string'), num = is('number'), bool = is('boolean');
const either = (...cs: Check[]): Check => (v, at) => { const all = cs.map((c) => c(v, at)); return all.some((p) => !p.length) ? [] : all[0]; };
const arr = (item: Check, { min = 0 } = {}): Check => (v, at) => {
  if (!Array.isArray(v)) return is('array')(v, at);
  if (v.length < min) return [`${at}: needs at least ${min} item${min > 1 ? 's' : ''}`];
  return v.flatMap((x, i) => item(x, `${at}[${i}]`));
};
const obj = (fields: Record<string, Check>, required: string[] = []): Check => (v, at) => {
  if (kind(v) !== 'object') return is('object')(v, at);
  const o = v as Record<string, unknown>;
  return [
    ...required.filter((k) => o[k] === undefined).map((k) => `${at}.${k}: missing`),
    ...Object.entries(fields).flatMap(([k, c]) => (o[k] === undefined ? [] : c(o[k], `${at}.${k}`))),
  ];
};
const nul: Check = (v, at) => (v === null ? [] : [`${at}: expected null`]);

const need = obj({ issue: str }, ['issue']);
const issue = obj({ issue: str, severity: str }, ['issue']);
const review: Check = (v, at) => {
  const p = obj({ pass: bool, issues: arr(issue), needs_user: arr(need), shots: arr(obj({ id: str, pass: bool, issues: arr(issue) }, ['id'])) })(v, at);
  if (p.length) return p;
  const o = v as Record<string, unknown>;   // a verdict is required: an empty review would read as "failed, nothing to fix"
  return typeof o.pass === 'boolean' || Array.isArray(o.issues) || Array.isArray(o.shots) ? [] : [`${at}: needs "pass", "issues" or "shots"`];
};
const fix = obj({ status: str, issue: str });
const fixes = either(arr(fix), obj({ fixes: arr(fix) }, ['fixes']));

const SCHEMAS: [RegExp, Check][] = [
  [/(^|\/)analysis\/route\.json$/, obj({ engine: str, style: str })],
  [/(^|\/)plan\.json$/, obj({
    title: str, version: either(num, str),
    characters: arr(obj({ id: str, name: str, file: str }, ['id'])),
    assets: arr(obj({ id: str, status: str })),
    required_inputs: arr(obj({ id: str, kind: str, label: str, file: str, match: str }, ['id', 'kind'])),
    music: obj({ file: str }),
  })],
  [/(^|\/)build\/production\.json$/, obj({
    chunks: arr(obj({ id: str, shots: arr(str, { min: 1 }) }, ['id', 'shots']), { min: 1 }),
    characters: arr(obj({ id: str, name: str, file: str, sheet: str }, ['id'])),
    rig_files: arr(str),
  }, ['chunks'])],
  [/(^|\/)out\/check\/critique\.json$/, obj({ must_fix: arr(either(nul, obj({ issue: str }, ['issue']))), needs_user: arr(need) })],
  [/(^|\/)(review(_[^/]+)?|[^/]+\.review)\.json$/, review],
  [/(^|\/)(fixes(_[^/]+)?|[^/]+\.fixes)\.json$/, fixes],
];

// Problems with one agent-written file (project-relative path), [] when it's fine. Any .json must at least parse.
export function checkFile(rel: string, text: string): string[] {
  let v: unknown;
  try { v = JSON.parse(text); } catch (e) { return [`${rel}: not valid JSON (${(e as Error).message})`]; }
  const s = SCHEMAS.find(([re]) => re.test(rel));
  return s ? s[1](v, rel) : [];
}
