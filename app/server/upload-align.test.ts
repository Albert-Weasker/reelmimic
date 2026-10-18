// POST /api/projects/:id/inputs (no ?for=): uploading the song is when waiting lyrics get timed.
// With a failing aligner the outcome must reach the chat instead of vanishing.
// Starts the real server on a spare port against a throwaway projects folder; PYTHON is bogus on
// purpose so the aligner cannot run. No agent is started.
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const TMP = mkdtempSync(join(tmpdir(), 'reelmimic-test-'));
const PORT = 20000 + Math.floor(Math.random() * 20000);
const server = spawn(process.execPath, [join(import.meta.dirname, 'index.ts')], { env: { ...process.env, PORT: String(PORT), REELMIMIC_PROJECTS: TMP, PYTHON: 'reelmimic-no-such-python' }, stdio: 'ignore' });
after(() => { server.kill(); rmSync(TMP, { recursive: true, force: true }); });

const ID = 't-align';
const D = join(TMP, ID);
mkdirSync(join(D, 'inputs'), { recursive: true });
writeFileSync(join(D, 'job.json'), JSON.stringify({ id: ID, title: 't', agent: 'claude', lang: 'en', stage: 'plan_review', chat: [], needs: [], pipeline: {} }));
writeFileSync(join(D, 'plan.json'), JSON.stringify({ music: { file: 'inputs/song.mp3' } }));
writeFileSync(join(D, 'inputs', 'lyrics.txt'), 'la la la\n');
writeFileSync(join(D, 'inputs', 'song.mp3'), '');

const get = async (path: string) => {
  for (let i = 0; i < 100; i++) { try { return await fetch(`http://127.0.0.1:${PORT}${path}`); } catch { await new Promise((r) => setTimeout(r, 100)); } }
  throw new Error('server did not start');
};

test('a failed alignment on upload answers the upload and says so in the chat', async () => {
  await get('/api/health');
  const fd = new FormData();
  fd.append('inputs', new Blob([new Uint8Array([1, 2, 3])]), 'extra.bin');
  const up = await fetch(`http://127.0.0.1:${PORT}/api/projects/${ID}/inputs`, { method: 'POST', body: fd });
  assert.equal(up.status, 200, 'the upload itself must succeed');
  let chat: { role?: string; text?: string }[] = [];
  for (let i = 0; i < 60; i++) {
    chat = ((await (await get(`/api/projects/${ID}`)).json()) as { job?: { chat?: { role?: string; text?: string }[] } }).job?.chat || [];
    if (chat.length) break;
    await new Promise((r) => setTimeout(r, 100));
  }
  const last = chat.at(-1);
  assert.equal(last?.role, 'system');
  assert.match(last?.text || '', /could not be timed/i);
  assert.ok(!existsSync(join(D, 'analysis', 'lyrics', 'subs.lrc')), 'no subs.lrc without a run');
});
