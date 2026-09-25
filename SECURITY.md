# Security policy

## Reporting a vulnerability

Please **do not open a public issue** for security problems. Report them
privately through GitHub:
**Security → Advisories → Report a vulnerability** on this repository.

Include the affected version or commit, steps to reproduce, and the impact.
You can expect an acknowledgement within a few days. Fixes are released as
soon as they are ready, and credit is given in the changelog unless you ask
not to be named.

## Supported versions

Thoth is released from `main`. Security fixes go to the latest commit on
`main`. Keep deployments current (see
[Upgrading](docs/operations/upgrading.md)).

## Security model

Thoth is designed for a **single operator or a small trusted team**. It has
no per-user accounts. Access is controlled by bearer tokens that can be
revoked.

### Exposure

```
user ──► reverse proxy (TLS) ──► app :3000 ──► api :4000 ──► db
```

- **Only the app faces users.** Compose binds the API to `127.0.0.1` (for
  host cron and debugging) and does not publish the database. The browser
  talks to the app's own origin, and the app proxies `/api/*` over the
  internal network.
- Behind a shared reverse proxy, the proxy joins the `thoth_edge` network,
  which contains **only** the app. It cannot reach the API or the database.

### Access gate (app)

When `APP_ACCESS_KEY` is set, every page and `/api` call needs a valid
token, presented in one of three ways:

- `Authorization: Bearer <key>`
- `?token=<key>`
- the `thoth_session` cookie

Opening `https://<host>/?token=<key>` sets a 30-day `HttpOnly` session
cookie, a stateless HS256 JWT, and redirects to the same URL **without**
the token. That keeps the key out of the address bar and browser history.
Each page load renews the window. Unauthenticated requests get a plain 401.
The server never sends a `WWW-Authenticate` header, so browsers do not show
a password prompt.

- **Revocation:** extra keys go in `APP_TOKENS` (`name:key,…`) or
  `APP_TOKENS_FILE` (JSON, re-read on every check), and can be removed one
  at a time. Rotating `APP_JWT_SECRET` (which defaults to `APP_ACCESS_KEY`)
  signs every browser out.
- **SSO:** with `APP_TRUST_UPSTREAM_AUTH=1`, an authenticating proxy in
  front is trusted to have vetted every request. Use this only if the app
  cannot be reached any other way.
- **Unset:** the app is open to anyone who can reach it. That is suitable
  only for local development.

### Write protection (API)

- Every POST, PUT, PATCH and DELETE on `/api` requires `API_WRITE_KEY`, sent
  as `Authorization: Bearer <key>` or `X-Thoth-Key`.
- With `NODE_ENV=production` and no key configured, the API **refuses all
  writes** (fail closed).
- The app attaches the key **server-side** and only for vetted callers, so
  the key never reaches the browser. The app never forwards a caller's own
  `Authorization` header to the API.

### Hardening in place

- Security headers on app and API responses: `X-Content-Type-Options`,
  `Referrer-Policy`, `X-Frame-Options: DENY` and `Permissions-Policy` on the
  app, and equivalents on the API.
- Per-client-IP rate limiting. The real client IP is resolved through
  `TRUST_PROXY`.
- zod validation of every environment variable at startup and of all API
  inputs. Request bodies are limited to 100 kB.
- Parameterized SQL only. Every statement has a timeout.
- Non-root, multi-stage container images with healthchecks and memory
  limits.
- Upstream secrets in URL paths are masked in the call log.
- `npm audit --omit=dev --audit-level=high` in CI. Automated dependency
  update PRs are turned off; update dependencies deliberately.

### Known limitations

- **No Content-Security-Policy on the app yet.** Tiles, fonts and video
  embeds come from several third-party origins, and the allowlist still
  needs an audit.
- **Single shared write key.** There is no per-user identity or audit trail
  for writes.
- **Per-process state.** Rate-limit and SSE state live in memory. That is
  fine for the single-API compose setup, but running several API replicas
  needs a shared store first.
- **Outbound fetches** go to a fixed set of upstream hosts defined in code.
  On-demand OSINT lookups pass user input to those upstreams as query
  parameters. Deploy on a network where outbound traffic from the worker
  and API is acceptable.

## Operator checklist

See [Deployment › Go-live checklist](docs/operations/deployment.md#go-live-checklist).
