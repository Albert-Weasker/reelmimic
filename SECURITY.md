# Security Policy

## Supported versions

Only the latest version on `main` is supported — fixes land there, not in
older snapshots.

## Reporting a vulnerability

Please don't open a public issue for a security problem. Report it privately
to **fya973619@gmail.com** (the maintainer's public contact); a first reply
usually comes within a few days. If the repository's Security tab offers
*Report a vulnerability* (GitHub private vulnerability reporting), that works
too.

## Scope

In scope: the app (`app/`), the server and scripts (`app/server/`,
`app/scripts/`) and the setup scripts. The vendored agent skills under
`.claude/skills/` are third-party work — report issues in them to their own
upstream projects through their own channels.

## How secrets are handled

API keys and tool paths live in `~/.reelmimic/secrets.json`, outside the
repository, and are never committed. The server binds to `127.0.0.1` and is
not exposed to the network by default, so treat the secrets file like any
other credential store: keep it out of backups you share and rotate a key if
it ever leaks.
