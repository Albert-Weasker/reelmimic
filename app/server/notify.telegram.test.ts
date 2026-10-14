// Telegram notifications: a local HTTP server stands in for the Bot API (TELEGRAM_API); only Telegram is configured here.
import { after, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdirSync, mkdtempSync, rmSync, truncateSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import type { Job, Stage } from '../shared/types.ts';

type Hit = { path: string; type: string; body: string };
let hits: Hit[] = [], status = 200, videoStatus = 200;
const srv = createServer((req, res) => {
  let body = '';
  req.setEncoding('latin1');
  req.on('data', (d) => (body += d)).on('end', () => {
    hits.push({ path: req.url || '', type: req.headers['content-type'] || '', body });
    const code = req.url?.endsWith('/sendVideo') && videoStatus !== 200 ? videoStatus : status;
    res.statusCode = code; res.end(code === 200 ? '{"ok":true}' : `{"ok":false,"error_code":${code},"description":"nope"}`);
  });
});
await new Promise<void>((r) => srv.listen(0, '127.0.0.1', r));

const TMP = mkdtempSync(join(tmpdir(), 'reelmimic-telegram-'));
Object.assign(process.env, { REELMIMIC_PROJECTS: TMP, TELEGRAM_BOT_TOKEN: '123:SECRET', TELEGRAM_CHAT_ID: '4242', TELEGRAM_API: `http://127.0.0.1:${(srv.address() as AddressInfo).port}`, REELMIMIC_URL: 'https://studio.example' });
delete process.env.DISCORD_WEBHOOK_URL; delete process.env.WEBHOOK_URL;
const J = await import('./jobs.ts');
const N = await import('./notify.ts');

const stop = N.startNotifier();
after(() => { stop?.(); srv.close(); rmSync(TMP, { recursive: true, force: true }); });
beforeEach(() => { hits = []; status = 200; videoStatus = 200; });

J.createJob({ id: 't1', title: 'brief line', agent: 'claude', brief: '', reference: { type: 'url', src: 'x' }, lang: 'en' });
writeFileSync(join(J.dirOf('t1'), 'plan.json'), JSON.stringify({ title: 'Lantern Walk' }));
const moveTo = (stage: Stage, extra: Partial<Job> = {}) => J.bus.emit('job', 't1', { type: 'job', job: { ...J.load('t1'), stage, ...extra } });
const settle = async (n: number) => { for (let i = 0; i < 25 && hits.length < n; i++) await new Promise((r) => setTimeout(r, 20)); await new Promise((r) => setTimeout(r, 50)); };
const video = join(J.dirOf('t1'), 'out', 'video.mp4');

test('Telegram alone turns the notifier on', () => assert.ok(stop));

test('plan ready: a plain-text message to the chat, with the title and the link', async () => {
  moveTo('plan_review');
  await settle(1);
  assert.equal(hits.length, 1);
  assert.equal(hits[0].path, '/bot123:SECRET/sendMessage');
  const m = JSON.parse(hits[0].body);
  assert.equal(m.chat_id, '4242');
  assert.equal(m.parse_mode, undefined);
  assert.equal(m.text, 'The plan for "Lantern Walk" is ready. Take a look and approve it to start production.\nhttps://studio.example/#/p/t1');
});

test('needs input lists what is needed', async () => {
  moveTo('needs_input', { needs: [{ issue: 'Confirm the lyric at 53.8 s', from: 'critic', at: '' }] });
  await settle(1);
  assert.match(JSON.parse(hits[0].body).text, /needs you:\n- Confirm the lyric at 53\.8 s/);
});

test('done: the video is sent with the message as its caption', async () => {
  mkdirSync(join(J.dirOf('t1'), 'out'), { recursive: true });
  writeFileSync(video, 'fake mp4 bytes');
  moveTo('done');
  await settle(1);
  assert.equal(hits[0].path, '/bot123:SECRET/sendVideo');
  assert.match(hits[0].type, /^multipart\/form-data/);
  assert.match(hits[0].body, /name="chat_id"\r\n\r\n4242\r\n/);
  assert.match(hits[0].body, /name="caption"\r\n\r\n"Lantern Walk" is done\.\r?\nhttps:\/\/studio\.example\/#\/p\/t1\r\n/);   // multipart turns \n into \r\n
  assert.match(hits[0].body, /filename="video\.mp4"/);
  assert.match(hits[0].body, /fake mp4 bytes/);
});

test('done: if the video upload fails, the message still goes out as text', async () => {
  videoStatus = 413;
  const orig = console.error; console.error = () => {};
  try { moveTo('producing'); moveTo('done'); await settle(2); } finally { console.error = orig; }
  assert.deepEqual(hits.map((h) => h.path), ['/bot123:SECRET/sendVideo', '/bot123:SECRET/sendMessage']);
  assert.match(JSON.parse(hits[1].body).text, /"Lantern Walk" is done\.\nhttps:\/\/studio\.example\/#\/p\/t1/);
});

test('done: a video over the 50 MB bot upload limit sends just the message', async () => {
  truncateSync(video, 51 * 1024 ** 2);   // sparse file, nothing is read
  moveTo('producing');
  moveTo('done');
  await settle(1);
  assert.equal(hits.length, 1);
  assert.equal(hits[0].path, '/bot123:SECRET/sendMessage');
  assert.match(JSON.parse(hits[0].body).text, /"Lantern Walk" is done\./);
});

test('an API error is logged without the bot token', async () => {
  status = 401;
  const logged: string[] = [], orig = console.error;
  console.error = (...a: unknown[]) => { logged.push(a.join(' ')); };
  try { moveTo('error', { error: 'Missing output: out/video.mp4' }); await settle(1); await new Promise((r) => setTimeout(r, 50)); }
  finally { console.error = orig; }
  assert.equal(hits.length, 1);
  assert.match(logged.join('\n'), /Telegram answered 401/);
  assert.doesNotMatch(logged.join('\n'), /SECRET/);
});
