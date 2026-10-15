// Cache for the installed-agent probe.
//
// agentStatus() spawns each CLI with --version, which is far too expensive to run on every
// request and cheap enough to re-run occasionally. It used to be cached for the lifetime of the
// process, so a Claude Code or Codex installed while the server was running never appeared in the
// picker until the next restart.
//
// AGENTS_TTL_MS overrides the window; 0 disables the cache (useful when testing the picker).
import { agentStatus } from './agents/index.ts';
import type { AgentStatus } from '../shared/types.ts';

const DEFAULT_TTL_MS = 5 * 60 * 1000;

export function createAgentCache(
  detect: () => AgentStatus = agentStatus,
  ttlMs: number = Number(process.env.AGENTS_TTL_MS ?? DEFAULT_TTL_MS),
  now: () => number = Date.now,
) {
  let cached: AgentStatus | null = null;
  let at = 0;
  return function status(): AgentStatus {
    if (cached && ttlMs > 0 && now() - at < ttlMs) return cached;
    cached = detect();
    at = now();
    return cached;
  };
}
