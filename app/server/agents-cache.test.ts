import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createAgentCache } from './agents-cache.ts';
import type { AgentStatus } from '../shared/types.ts';

function clock(start = 1_000) {
  let t = start;
  return { now: () => t, advance: (ms: number) => { t += ms; } };
}

test('reuses the detection inside the ttl', () => {
  const c = clock();
  let calls = 0;
  const detect = (): AgentStatus => { calls += 1; return { claude: `v${calls}`, codex: null }; };
  const status = createAgentCache(detect, 1000, c.now);
  assert.equal(status().claude, 'v1');
  c.advance(999);
  assert.equal(status().claude, 'v1');
  assert.equal(calls, 1);
});

test('re-detects once the ttl has passed, so a new CLI shows up without a restart', () => {
  const c = clock();
  let calls = 0;
  const detect = (): AgentStatus => { calls += 1; return { claude: null, codex: calls > 1 ? 'codex 1.0' : null }; };
  const status = createAgentCache(detect, 1000, c.now);
  assert.equal(status().codex, null);
  c.advance(1000);
  assert.equal(status().codex, 'codex 1.0');
  assert.equal(calls, 2);
});

test('a ttl of zero disables the cache', () => {
  let calls = 0;
  const detect = (): AgentStatus => { calls += 1; return { claude: null, codex: null }; };
  const status = createAgentCache(detect, 0, () => 0);
  status();
  status();
  assert.equal(calls, 2);
});
