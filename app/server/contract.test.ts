// contract.ts: what an agent-written file must look like before the server acts on it.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { checkFile } from './contract.ts';

const ok = (f: string, v: unknown) => assert.deepEqual(checkFile(f, JSON.stringify(v)), []);
const bad = (f: string, v: unknown, re: RegExp) => { const p = checkFile(f, typeof v === 'string' ? v : JSON.stringify(v)); assert.ok(p.some((x) => re.test(x)), p.join('\n') || 'no problems'); };

describe('checkFile', () => {
  test('any .json must parse; files without a schema need nothing more', () => {
    bad('out/check/shots/C1.done.json', '{ oops', /not valid JSON/);
    ok('out/check/shots/C1.done.json', { anything: 1 });
  });
  test('plan.json: the CONTRACT.md example passes, wrong field types are named', () => {
    ok('plan.json', { version: 1, title: 'T', music: { file: 'inputs/song.mp3', section: { start_s: 100.84, end_s: 131.7 } }, characters: [{ id: 'zhai', name: '阿宅', design: '…' }], assets: [{ id: 'A1', status: 'to_fetch' }], required_inputs: [{ id: 'lyrics', kind: 'lyrics' }], shots: [{ id: 'S1', camera: { move: 'dolly_in' } }] });
    bad('plan.json', { characters: [{ name: 'no id' }] }, /plan\.json\.characters\[0\]\.id: missing/);
    bad('plan.json', { required_inputs: [{ id: 'x' }] }, /required_inputs\[0\]\.kind: missing/);
    bad('plan.json', [], /expected object, got array/);
  });
  test('production.json needs chunks with shots', () => {
    ok('build/production.json', { chunks: [{ id: 'C1', shots: ['S1', 'S2'] }], characters: [{ id: 'hero', file: 'build/hero.js', sheet: 'out/check/cast/sheet_hero.jpg' }] });
    bad('build/production.json', {}, /chunks: missing/);
    bad('build/production.json', { chunks: [] }, /at least 1/);
    bad('build/production.json', { chunks: [{ id: 'C1', shots: [] }] }, /chunks\[0\]\.shots: needs at least 1/);
  });
  test('reviews need a verdict; issues need their text', () => {
    ok('out/check/cast/review.json', { pass: true, issues: [] });
    ok('out/check/cast/review_hero.json', { issues: [{ issue: 'arm floats', severity: 'blocker' }] });
    ok('out/check/shots/S1.review.json', { shots: [{ id: 'S1', pass: false, issues: [{ time: 1.2, where: 'left', issue: 'seam' }] }] });
    bad('out/check/shots/S1.review.json', { summary: 'looks fine' }, /needs "pass", "issues" or "shots"/);
    bad('out/check/cast/review.json', { pass: 'yes' }, /pass: expected boolean/);
    bad('out/check/cast/review.json', { pass: false, issues: ['arm'] }, /issues\[0\]: expected object/);
    bad('out/check/cast/review.json', { pass: false, needs_user: [{ kind: 'lyrics' }] }, /needs_user\[0\]\.issue: missing/);
  });
  test('fixes files: a list or { fixes }', () => {
    ok('out/check/shots/C1.fixes.json', [{ shot: 'S1', change: 'x', status: 'fixed' }]);
    ok('out/check/cast/fixes_hero.json', { fixes: [{ status: 'shared', issue: 'rig neck' }] });
    bad('out/check/fixes.json', { done: true }, /expected array/);
  });
  test('critique: must_fix items need an issue (nulls are tolerated); display fields are free', () => {
    ok('out/check/critique.json', { pass: false, must_fix: [{ shot: 'S1', time: '3.2s', issue: 'seam' }, null], needs_user: [] });
    bad('out/check/critique.json', { must_fix: [{ shot: 'S1' }] }, /must_fix\[0\]/);
  });
});
