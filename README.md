# ParkingBusiness

NestJS + TypeScript modular-monolith backend with PostgreSQL and Drizzle.
Checkpoint 1 provides startup/configuration, a connection pool, Clock and a real
database smoke test. No business endpoints, tables or migrations exist yet.

## Local setup

Requires Node.js 24, npm 11 and Docker with Compose. PostgreSQL 17 is used locally.

```sh
npm ci --ignore-scripts
cp .env.example .env
npm run db:up
npm run dev
```

The app binds to `127.0.0.1:3000` by default and checks PostgreSQL before listening.
An HTTP request receives 404 because no routes are implemented. `Ctrl+C` closes
the pool. Missing/invalid configuration or unavailable PostgreSQL fails startup
with an actionable error without printing the database URL. For production-style
local startup: `npm run build` then `npm start`.

```sh
npm run lint
npm test
npm run test:integration
npm run db:down
```

The integration test requires `TEST_DATABASE_URL` and executes read-only queries
against a real PostgreSQL server; it does not silently skip without a database.
For this smoke test it may use the development database. Checkpoint 2 will add an
isolated test database before any destructive setup, migrations or race tests.
Compose keeps data across stops; its credentials are public local-only defaults.
Port 5432 must be available. Real `.env` files are ignored; do not commit secrets.

## Configuration and initial limits

Only `DATABASE_URL` is required; other settings have defaults shown in
[.env.example](.env.example). Numeric settings must be positive integers.

| Setting | Default | Purpose |
| --- | --- | --- |
| PORT | 3000 | Loopback HTTP listener |
| DB_POOL_MAX | 5 | Small pilot pool, enough for separate concurrent connections |
| DB_CONNECTION_TIMEOUT_MS | 250 | Bound pool acquisition/new connection waiting |
| DB_POOL_IDLE_TIMEOUT_MS | 10000 | Evict unused connections |
| DB_STATEMENT_TIMEOUT_MS | 1000 | PostgreSQL limit per statement |
| DB_LOCK_TIMEOUT_MS | 250 | Fail lock waits earlier than the statement limit |
| DB_IDLE_TRANSACTION_TIMEOUT_MS | 1000 | End abandoned idle transactions |

Lock timeout must be less than statement timeout. These are configurable starting
values, not proof of the 1.5-second use-case target: later endpoints must enforce
an end-to-end budget across pool acquisition and multiple statements. Startup may
need larger connection limits on a remote database. No locking abstraction is added.

Package versions are pinned in package.json/package-lock.json. The simulator is
an independent supplied package; application commands do not install or modify it.
Build uses TypeScript directly, development uses tsx with Node's watcher, and
Node's test runner avoids another test framework. Installs disable lifecycle scripts;
the platform-specific esbuild package used by tsx works without running them.

Current dependency audit: production dependencies have no reported vulnerabilities;
the lint toolchain has moderate minimatch advisories. See the checkpoint journal
for triage. Reassess before Checkpoint 2's audit CI; no forced upgrades were applied.

See [architecture](docs/architecture.md), [specifications](specs/PB-03-check-in.md),
[agent instructions](AGENTS.md) and [journal](JOURNAL.md). CI, migrations and seed
data belong to Checkpoint 2.
