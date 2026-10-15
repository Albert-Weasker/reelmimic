// When Python can't be started the job fails with a clear message instead of the server crashing (unhandled 'error').
// Runs against a throwaway projects folder with PYTHON pointing at a command that doesn't exist. No agent is started.
import { after, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const TMP = mkdtempSync(join(tmpdir(), 'reelmimic-test-'));
process.env.REELMIMIC_PROJECTS = TMP;
process.env.PYTHON = 'reelmimic-no-such-python';
const J = await import('./jobs.ts');
after(() => rmSync(TMP, { recursive: true, force: true }));

let n = 0;
const newJob = () => J.createJob({ id: `py-${++n}`, title: 'test', agent: 'claude', brief: 'a brief', reference: { type: 'url', src: 'https://example.com/v' } });

describe('Python missing', () => {
  test('analysis fails the job with a "Python not found" message', async () => {
    const { id } = newJob();
    await J.start(id);
    const j = J.load(id);
    assert.equal(j.stage, 'error');
    assert.equal(j.failed, 'analyzing');
    assert.match(j.error || '', /reelmimic-no-such-python could not be started.*Python 3\.10\+/);
  });
  test('lyrics alignment reports failure', async () => {
    const { id } = newJob();
    writeFileSync(join(J.dirOf(id), 'inputs', 'song.mp3'), '');
    const r = await J.saveLyrics(id, '第一句\n第二句');
    assert.deepEqual({ ok: r.ok, aligned: r.aligned }, { ok: false, aligned: false });
    assert.ok(J.snapshot(id).job.log.some((e) => e.type === 'error' && /could not be started/.test(e.text || '')));   // the log lives in events.jsonl, not job.json
  });
});
