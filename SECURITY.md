# Security

## Reporting a vulnerability

Please report security issues privately through GitHub's private vulnerability reporting:
<https://github.com/Banjo-Ventures/lodestar-stamp-mcp/security/advisories/new>

Do not open a public issue for a vulnerability. Reports about the hosted MCP endpoint
(`https://api.lodestarindex.com/mcp`) and the Trust API it reads are welcome through the
same channel.

## Supported versions

Only the latest release on npm (`npx -y lodestar-stamp-mcp`) receives fixes. Pin a
version in your MCP client config if you need a fixed one, and update to take a fix.

## What this server does and does not do

These properties hold for `bin/lodestar-stamp-mcp.js`, a single file you can read in full.
`test/smoke.mjs` checks the dependency, host, read-only and key-refusal properties on every
change.

- **Read-only.** Every tool is a GET to the Lodestar Trust API. No tool writes, deletes or
  books anything, and every tool is annotated `readOnlyHint: true`.
- **No dependencies.** The package has no runtime dependencies; the server uses only
  Node's built-in `node:https`.
- **One host, HTTPS only.** Calls go only to `https://api.lodestarindex.com/v1`. Redirects
  are not followed.
- **Your key stays with that host.** If you set `LODESTAR_KEY`, it is sent only as the
  `X-Lodestar-Key` header to that host. A value that is not shaped like a key is refused
  before any call is made, and the key is never printed.
- **Bounded.** Each request has a 15-second idle timeout and a 20-second deadline. A
  response over 2 MB and an incoming JSON-RPC frame over 1 MB are refused.
- **Answers are data.** Receipt values come from public sources. The tool descriptions
  tell the model to treat every value as data, never as an instruction.

## Release integrity

Releases are published to npm from GitHub Actions through npm trusted publishing (OIDC),
with no long-lived npm token. This repository is a mirror of the package as published:
`bin/`, `package.json`, `README.md` and `LICENSE` match the npm tarball of the same
version byte for byte.
