// Output checks: what counts as a readable agent output (JSON that parses, in the shape the orchestrator reads).
import { after, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { checkOutputs, parseJSON, repairPrompt } from './outputs.ts';

const D = mkdtempSync(join(tmpdir(), 'reelmimic-out-'));
after(() => rmSync(D, { recursive: true, force: true }));
const put = (f: string, text: string) => { mkdirSync(join(D, f, '..'), { recursive: true }); writeFileSync(join(D, f), text); };

describe('agent outputs', () => {
  test('valid files pass, a byte-order mark is not an error', () => {
    put('out/check/critique.json', '\uFEFF{ "must_fix": [], "pass": true }');
    put('build/production.json', JSON.stringify({ chunks: [{ id: 'C1', shots: ['S1'] }] }));
    put('out/check/shots/C1.fixes.json', JSON.stringify({ fixes: [] }));
    put('out/video.mp4', 'not json, not checked');
    assert.deepEqual(checkOutputs(D, ['out/check/critique.json', 'build/production.json', 'out/check/shots/C1.fixes.json', 'out/video.mp4']), []);
    assert.deepEqual(parseJSON('\uFEFF[1]'), [1]);
  });
  test('broken JSON and wrong shapes are reported with the file', () => {
    put('a/critique.json', '{ "must_fix": [ { "issue": "x" }, ] }');
    put('b/production.json', JSON.stringify({ shots: [] }));
    put('c/review_hero.json', JSON.stringify([{ pass: true }]));
    put('d/fixes.json', JSON.stringify({ issue: 'x' }));
    put('e/critique.json', JSON.stringify({ must_fix: 'none' }));
    const got = Object.fromEntries(checkOutputs(D, ['a/critique.json', 'b/production.json', 'c/review_hero.json', 'd/fixes.json', 'e/critique.json']).map((p) => [p.file, p.problem]));
    assert.match(got['a/critique.json'], /not valid JSON/);
    assert.match(got['b/production.json'], /chunks/);
    assert.match(got['c/review_hero.json'], /object/);
    assert.match(got['d/fixes.json'], /list of fixes/);
    assert.match(got['e/critique.json'], /must_fix/);
  });
  test('missing files are left to the mtime check, and the repair prompt names every file', () => {
    assert.deepEqual(checkOutputs(D, ['nope/critique.json']), []);
    const p = repairPrompt('projects/x', [{ file: 'out/check/critique.json', problem: 'not valid JSON' }]);
    assert.match(p, /專案資料夾：projects\/x（/);
    assert.match(p, /^- out\/check\/critique\.json：not valid JSON$/m);
  });
});
