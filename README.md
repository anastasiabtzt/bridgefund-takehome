# ParkingBusiness

NestJS + TypeScript modular-monolith backend with PostgreSQL and Drizzle.
The foundation includes startup/configuration, Clock, reviewed SQL migrations,
deterministic pilot seed, database constraint tests and CI. Check-in, check-out,
payment confirmations and public occupancy are implemented.

## Local setup

Requires Node.js 24, npm 11 and Docker with Compose. PostgreSQL 17 is used locally.

```sh
npm ci --ignore-scripts
cp .env.example .env
npm run db:up
npm run db:migrate
npm run db:seed
npm run dev
```

The app binds to `127.0.0.1:3000` by default and checks PostgreSQL before listening.
`GET /occupancy` is public; check-in/check-out require configured gate credentials.
`Ctrl+C` closes the pool. Missing/invalid configuration or unavailable PostgreSQL fails startup
with an actionable error without printing the database URL. For production-style
local startup: `npm run build` then `npm start`.

Install the independent simulator with `npm ci --prefix simulator --ignore-scripts`
before integration tests: payment integration tests launch its actual HTTP sender.

```sh
npm run lint
npm test
npm run test:integration
npm test --prefix simulator
npm run audit:dependencies
npm run db:down
```

Compose runs development PostgreSQL on port 5432 with a persistent volume, and a
separate disposable test server on port 5433 with tmpfs data. Both bind loopback.
Credentials are public local-only defaults; real `.env` files are ignored.

Integration tests **reset the test database**, then run real migrations and seed.
They require `TEST_DATABASE_URL`, database/user `parkingbusiness_test`, no URL query
parameters, and a different configured development target. The live server's
database/user identity is checked before any reset. Wrong/missing configuration
fails rather than skipping tests. Do not rename a development database to the test
identity or point tests at data you need. `npm run db:test:fresh` recreates only the
disposable test service; it never removes the development service or volume.

Keep an existing `.env` in sync with the new test URL in `.env.example`; the old
Checkpoint 1 smoke-test URL intentionally fails the new guard. Integration files
run serially; concurrency tests acquire separate PostgreSQL connections and
exercise uncommitted unique-index contention without assuming timing via sleeps.
Two simultaneous local integration-test runs must not share this disposable
database: each run resets its schemas and could invalidate the other's fixtures.
Run them sequentially or use separately isolated PostgreSQL instances. Settlement
tests reserve three connections (default pool size is five), prove blocking via
`pg_blocking_pids`, use actual COMMIT and read final state through a third connection.

## Persistence and migrations

`src/database/schema.ts` defines the five domain tables. `npm run db:generate`
generates SQL and Drizzle snapshots; review SQL before committing, then run
`npm run db:migrate`. Never use schema push or auto-migrate at app startup.
`drizzle/0001_history_guards.sql` is a reviewed custom migration: append-only gate
outcomes/payment events, frozen session facts/checkout, forward-only transitions
and deferred settlement/session consistency. Keep those guards when adding future
migrations; generated snapshots do not describe custom triggers.

Sessions are the allocation source of truth. Partial unique indexes enforce one
active plate per building and one active allocation per building/space. Composite
foreign keys prevent cross-building references. Money uses bigint integer cents
bounded to JavaScript's safe-integer range. Constraints protect lifecycle shape;
the Billing calculation applies started-hour rates and per-Amsterdam-calendar-day
caps when checkout freezes the charge. Deferred consistency checks let
one transaction update payment and session in either write order, but reject an
inconsistent commit. Privileged administrators can bypass guards; normal application
SQL must not disable them. Constraint triggers add no endpoint or background worker.

`npm run db:seed` inserts `PB-AMS-9X4T` and IDs 1–150, with floors/eligibility from
the approved layout. Re-running inserts missing rows without updating existing
configuration, sessions, request outcomes or payment events. After inserting missing
records, seed validates the timezone and exact 150-space layout, including floors
and encoded vehicle eligibility. A mismatch fails with a non-sensitive error and
rolls back all seed inserts; it never repairs drift or deletes operational data.
Migration/seed commands
run from the repository root and target DATABASE_URL; test resets use only the
separate guarded TEST_DATABASE_URL.

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

Lock timeout must be less than statement timeout. The gate vendor waits two seconds
for a response before retrying a request without an answer. The 1.5-second
use-case target is an internal engineering target, not a vendor requirement or a
demonstrated SLA. Pool acquisition, statement and lock waits have individual
bounds, but no aggregate end-to-end HTTP deadline is enforced; no measured latency
or load-test result is claimed. Startup may need larger connection limits on a
remote database. No locking abstraction is added.

Package versions are pinned in package.json/package-lock.json. The simulator is
an independent supplied package; application commands do not install or modify it.
Build uses TypeScript directly, development uses tsx with Node's watcher, and
Node's test runner avoids another test framework. Installs disable lifecycle scripts;
the platform-specific esbuild package used by tsx works without running them.

Current dependency audit: production dependencies have no reported vulnerabilities;
the lint toolchain has a moderate minimatch advisory and Drizzle Kit's transitive
esbuild loader has a moderate development-server advisory. `npm run audit:dependencies`
runs native npm audits for both lockfiles. Only GHSA-g3hv-75wg-m249 and
GHSA-67mh-4wv8-2f99 are deferred for dev-only paths until review before 2026-11-19:
lint uses fixed local globs, and esbuild serve/Drizzle Studio is not exposed. New
advisories, runtime findings, failed audit requests and expired exceptions fail CI.
No forced upgrades or global severity suppression. The simulator's Axios was
updated to a stable audited version; its signed HTTP transport is tested locally.

GitHub Actions uses PostgreSQL 17 and runs lockfile installs, build, lint (including
simulator), unit/integration tests, simulator tests and the scoped dependency audit.

See [architecture](docs/architecture.md), [specifications](specs/PB-03-check-in.md),
[agent instructions](AGENTS.md) and [journal](JOURNAL.md).

### Check-in gate access

`POST /check-in` requires a per-gate bearer credential and one UUID
`X-Request-Id`. Configure `GATE_CREDENTIALS` as a JSON array in your local `.env`:

```text
GATE_CREDENTIALS=[{"id":"entrance-1","buildingId":"PB-AMS-9X4T","role":"ENTRANCE","secret":"REPLACE_WITH_A_UNIQUE_RANDOM_SECRET"}]
```

Generate each secret with `node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"`.
Do not use the placeholder. Configure a different secret for each entrance/exit
identity; roles are `ENTRANCE` or `EXIT`. Only entrance credentials can check in.
An absent/empty array disables gate access while public occupancy remains available.
Secrets must be 32–256 printable ASCII characters; never commit real credentials.

The body is exactly `vehicleType` (`CAR`/`MOTOR`), `isResident` (boolean) and
`licensePlate` (see [PB-03](specs/PB-03-check-in.md)). The body limit is 4 KiB.
The pilot derives the building from gate configuration. Reuse the same request UUID
for retries of one event, including after an uncertain response. Committed success,
full-capacity and duplicate-plate outcomes replay unchanged. A new physical event
requires a new UUID. The individually bounded database waits and internal response
target are described above.

### Check-out

`POST /check-out` uses an `EXIT` credential from `GATE_CREDENTIALS`, JSON and one
UUID `X-Request-Id`. Body: `{"parkingSessionId":"<session UUID>","isResident":false}`.
The resident flag must match the stored session. Successful responses are **200**:

```json
{"parkingSpaceId":51,"sessionLengthInMinutes":70,"amountDue":{"value":1000,"currency":"EUR"}}
```

The first valid checkout freezes time, whole-minute duration and integer-cent
charge. Billing uses started hours per Amsterdam calendar day and that day's cap;
70 minutes for a visitor car costs 1000 cents. Zero charge completes and releases
logical allocation; positive charge awaits payment and retains allocation. Repeats
return the frozen result, including under a new request UUID (which gets its own
immutable outcome). Reuse one UUID when retrying an uncertain operation.

Malformed/oversized JSON can receive 400/413 before gate authentication. Other
checkout failures use the [PB-04 error contract](specs/PB-04-check-out.md).
Checkout 200 is not a barrier command. Payment webhooks settle backend sessions;
payment-success notifications to exit controllers remain outside the backend scope.

### Payment confirmations

`POST /webhooks/payments` requires JSON and exactly one lowercase-hex `X-Signature`:
HMAC-SHA256 over the exact body bytes using `WEBHOOK_SECRET`. Set the provider-shared
secret in local/deployment configuration; do not commit it. An unset/empty secret
fails authentication closed. Nest retains the raw body under the existing 4 KiB
limit. Non-identity Content-Encoding (including gzip) is rejected with 415 before
decompression on the payment route. Gate credentials and `X-Legacy-Exit` do not
authenticate provider calls.
Unsigned legacy terminals remain unsupported by the approved security policy.

Use the [PB-05 payload/error contract](specs/PB-05-payment-confirmation.md).
Accepted events return an empty **204 after commit**. Events bind immutable
`(pilot provider, paymentId)` identities throughout the pilot; conflicting reuse
returns 409 PAYMENT_ID_REUSED. Payment IDs preserve valid Unicode exactly (at most
128 code points); NUL and unpaired surrogates are rejected before database work. Only exact EUR PAID settlement of the frozen charge
completes an awaiting-payment session and releases logical allocation. FAILED
records its original amount/currency without settling, even when they mismatch.
A distinct PAID after completion is recorded for reconciliation, without another
settlement/release or an assumption that a duplicate charge occurred.

PAID/FAILED before checkout return uncached 409 CHECKOUT_REQUIRED. The same event
can redeliver after checkout, but the provider's 24-hour retry window does not
guarantee recovery. Transient database errors return 503 without an accepted binding.
Webhook 204 is not a barrier command or a payment-success message delivered to a gate.
Unexpected processing failures emit one sanitized diagnostic containing operation, a
generated correlation UUID, classification and SQLSTATE when available. Payment IDs,
session IDs, bodies, signatures, secrets, SQL parameters and raw messages are omitted.

The existing [simulator](simulator/README.md) can call the running backend:

```sh
WEBHOOK_SECRET='<same provider secret>' node simulator/send-webhook.mjs --session <session-uuid> --amount 1000
```

Use the frozen checkout amount and keep the signing secret identical on both sides.
The simulator's legacy scenario should receive 401. Payment initiation, refunds,
notification delivery and physical barrier control are not implemented.
