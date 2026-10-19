// Optional: post a finished video to social platforms through Upload-Post (https://upload-post.com).   npm run post-video -- <project>
// Never runs on its own: nothing in the pipeline calls it, and it only takes a project whose final review passed.
// Without --send it is a dry run: it prints what it would post and sends nothing.
//   npm run post-video -- 20261003-ab12c --platforms tiktok,instagram,youtube
//   npm run post-video -- 20261003-ab12c --platforms tiktok --title "Bath Time" --at 2026-10-05T18:00 --tz Europe/Madrid --send
// Needs UPLOAD_POST_KEY (an API key) and UPLOAD_POST_USER (the profile the accounts are connected to) in ~/.reelmimic/secrets.json.
// UPLOAD_POST_API overrides the API address (the key is sent there), e.g. for a staging server.
// @ts-check
import { createHash } from 'node:crypto';
import { existsSync, openAsBlob, readFileSync, statSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { parseArgs } from 'node:util';

await import('../server/env.ts');   // same secrets as the server
const API = process.env.UPLOAD_POST_API || 'https://api.upload-post.com';
const PROJECTS = process.env.REELMIMIC_PROJECTS ? resolve(process.env.REELMIMIC_PROJECTS) : join(import.meta.dirname, '..', '..', 'projects');

/** @param {string} m */
const fail = (m) => { console.error(`  \x1b[31m✗\x1b[0m ${m}`); process.exit(1); };
/** @param {string} p */
const readJSON = (p) => { try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return null; } };

const { values: o, positionals } = parseArgs({ allowPositionals: true, options: {
  platforms: { type: 'string' }, title: { type: 'string' }, description: { type: 'string' },
  at: { type: 'string' }, tz: { type: 'string' }, send: { type: 'boolean', default: false }, force: { type: 'boolean', default: false },
} });
const id = positionals[0];
if (!id || !o.platforms) fail('usage: npm run post-video -- <project id> --platforms tiktok,instagram [--title …] [--description …] [--at 2026-10-05T18:00 --tz Europe/Madrid] [--send] [--force]');
if (!/^[\w-]+$/.test(id)) fail(`not a project id: ${id}`);
const dir = join(PROJECTS, id), job = readJSON(join(dir, 'job.json')), video = join(dir, 'out', 'video.mp4');
if (!job) fail(`no such project: ${dir}`);
// Only after the final review: a video still being produced or revised is not the one you approved.
if (job.stage !== 'done') fail(`project is "${job.stage}", not "done". Publish only once the final review is finished`);
// "done" also means the final review stopped at its round limit with must-fix items left: require a pass, or --force.
if (!job.lastCritique?.pass) {
  const why = job.lastCritique ? `the final review did not pass (${job.lastCritique.must} must-fix item(s) left)` : 'no final review result on record';
  if (!o.force) fail(`${why}. Fix them first, or pass --force to post it anyway`);
  console.log(`  [33m![0m ${why}; posting anyway (--force)`);
}
if (!existsSync(video)) fail(`no final video at ${video}`);
const platforms = String(o.platforms).split(',').map((p) => p.trim().toLowerCase()).filter(Boolean);
const title = (o.title || readJSON(join(dir, 'plan.json'))?.title || job.title || '').trim();
if (!title && platforms.includes('youtube')) fail('YouTube needs a title: pass --title');
if (o.tz && !o.at) fail('--tz only applies with --at');

// Same project + video file + target (profile, platforms, time and time zone) → same key, so a retried run never posts the
// video twice, while correcting --tz (or --at) is a new request instead of silently returning the earlier schedule.
const st = statSync(video), idem = createHash('sha256').update(`${id}:${st.size}:${st.mtimeMs}:${process.env.UPLOAD_POST_USER || ''}:${platforms.join(',')}:${o.at || ''}:${o.tz || ''}`).digest('hex').slice(0, 32);
const form = new FormData();
form.append('user', process.env.UPLOAD_POST_USER || '');
for (const p of platforms) form.append('platform[]', p);
if (title) form.append('title', title);
if (o.description) form.append('description', o.description);
if (o.at) form.append('scheduled_date', o.at);
if (o.tz) form.append('timezone', o.tz);
form.append('async_upload', 'true');

console.log(`\n  ${basename(dir)} · ${(st.size / 1024 ** 2).toFixed(1)} MB · ${platforms.join(', ')}${o.at ? ` · scheduled ${o.at}${o.tz ? ` ${o.tz}` : ' UTC'}` : ' · now'}\n  title: ${title || '(none)'}`);
if (!o.send) { console.log('\n  Dry run, nothing sent. Add --send to post it.\n'); process.exit(0); }
if (!process.env.UPLOAD_POST_KEY || !process.env.UPLOAD_POST_USER) fail('set UPLOAD_POST_KEY and UPLOAD_POST_USER in ~/.reelmimic/secrets.json');

form.append('video', await openAsBlob(video, { type: 'video/mp4' }), `${id}.mp4`);
const res = await fetch(`${API}/api/upload`, { method: 'POST', body: form, headers: { Authorization: `Apikey ${process.env.UPLOAD_POST_KEY}`, 'Idempotency-Key': idem } });
const body = /** @type {Record<string, any>} */ (await res.json().catch(() => ({})));
if (!res.ok) fail(`Upload-Post answered ${res.status}: ${body.message || body.error || JSON.stringify(body)}`);
console.log(`  \x1b[32m✓\x1b[0m ${o.at ? 'scheduled' : 'sent'}${body.request_id ? ` · request_id ${body.request_id}` : ''}${body.job_id ? ` · job_id ${body.job_id}` : ''}`);
console.log('    Progress and post links: https://app.upload-post.com (or GET /api/uploadposts/status?request_id=…)\n');
