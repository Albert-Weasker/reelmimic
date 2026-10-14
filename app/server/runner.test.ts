// runner.ts: one flow per project, and cancel reaches every process it started (including their children).
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import * as R from './runner.ts';

const alive = (pid: number) => { try { process.kill(pid, 0); return true; } catch { return false; } };
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('runner', () => {
  test('a second run for the same project is refused until the first ends', async () => {
    let done!: () => void;
    const first = R.run('a', () => new Promise<void>((r) => { done = r; }));
    await assert.rejects(R.run('a', async () => {}), R.Busy);
    await R.run('b', async () => {});   // other projects are not affected
    done(); await first;
    assert.equal(R.active('a'), false);
    await R.run('a', async () => {});
  });

  test('cancel aborts the run signal', async () => {
    await R.run('c', async () => { R.cancel('c'); assert.equal(R.signalOf('c').aborted, true); assert.equal(R.aborted('c'), true); });
  });

  test('cancel kills a tool process and the processes it started', { skip: process.platform === 'win32' }, async () => {
    const p = R.spawnTool('d', 'sh', ['-c', 'sleep 30 & echo $!; wait']);
    const grandchild = await new Promise<number>((r) => p.stdout.once('data', (b) => r(+String(b).trim())));
    const closed = new Promise((r) => p.on('close', r));
    assert.ok(alive(grandchild));
    R.cancel('d');
    await closed; await wait(100);
    assert.equal(alive(grandchild), false);
  });
});
