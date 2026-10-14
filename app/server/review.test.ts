// review.ts: the review → fix loop every gate shares, and the pass rule.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { blockerFree, reviewFix, sharedItems } from './review.ts';

const trace = (passAt: number, o: { limit?: number; failFix?: number; needsAt?: number; handoffAt?: number } = {}) => {
  const seen: string[] = [];
  return reviewFix<number>({
    review: async (r) => { seen.push(`review ${r}`); return r; },
    verdict: (r) => (r === o.needsAt ? 'needs' : r >= passAt ? 'passed' : 'fix'),
    limit: () => o.limit ?? 3,
    fix: async (r) => { seen.push(`fix ${r}`); return r === o.failFix ? 'error' : r === o.handoffAt ? 'handoff' : 'ok'; },
  }).then((res) => ({ ...res, seen }));
};

describe('reviewFix', () => {
  test('review → fix until it passes', async () => {
    const r = await trace(3);
    assert.equal(r.end, 'passed'); assert.equal(r.round, 3);
    assert.deepEqual(r.seen, ['review 1', 'fix 1', 'review 2', 'fix 2', 'review 3']);
  });
  test('stops at the limit without a last fix', async () => {
    const r = await trace(9, { limit: 2 });
    assert.equal(r.end, 'limit'); assert.equal(r.last, 2);
    assert.deepEqual(r.seen, ['review 1', 'fix 1', 'review 2']);
  });
  test('needs, a failed fix and a handoff end the loop', async () => {
    assert.equal((await trace(9, { needsAt: 2 })).end, 'needs');
    assert.equal((await trace(9, { failFix: 1 })).end, 'error');
    assert.equal((await trace(9, { handoffAt: 2 })).end, 'handoff');
  });
  test('a failed review ends it as an error', async () => {
    const r = await reviewFix<number>({ review: async () => null, verdict: () => 'passed', limit: () => 3, fix: async () => 'ok' });
    assert.deepEqual(r, { end: 'error', round: 1, last: null });
  });
});

describe('blockerFree', () => {
  test('only polish left passes; any blocker fails; no severities → the pass flag', () => {
    assert.equal(blockerFree({ issues: [{ issue: 'a', severity: 'polish' }] }), true);
    assert.equal(blockerFree({ issues: [{ issue: 'a', severity: 'polish' }, { issue: 'b', severity: 'blocker' }], pass: true }), false);
    assert.equal(blockerFree({ issues: [{ issue: 'a' }], pass: true }), true);
    assert.equal(blockerFree({}), false);
  });
  test('sharedItems reads both file shapes', () => {
    assert.deepEqual(sharedItems([{ status: 'shared', issue: 'x' }, { status: 'fixed', issue: 'y' } as never]), [{ status: 'shared', issue: 'x' }]);
    assert.equal(sharedItems({ fixes: [{ status: 'shared', issue: 'x' }] }).length, 1);
    assert.deepEqual(sharedItems(null), []);
  });
});
