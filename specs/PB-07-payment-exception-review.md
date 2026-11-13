# PB-07: Payment Exception Review

Status: implementation-ready future specification; PB-07 documentation commit
authorized on 2026-11-13 after independent review. Implementation is not authorized.
Sources: [roadmap](../ROADMAP.md), [PB-05](PB-05-payment-confirmation.md),
[architecture](../docs/architecture.md), [schema](../src/database/schema.ts).

## Story, scope and invariants

As a ParkingBusiness operator, I want to list payment events already marked
`RECONCILIATION_REQUIRED` so I can investigate unexpected PAID confirmations.
This is visibility, not an assertion that a second charge occurred. The existing
PB-05 webhook decides and durably records that disposition. This feature only
reads those committed rows for the pilot building `PB-AMS-9X4T`.

No payment-event, session or allocation writes; no change to settlement,
deduplication, checkout, occupancy or gate behavior. No acknowledgement/resolution
state, refunds, payment initiation, queue, migration, new index or generic
authorization framework. Rejected pre-checkout events have no durable payment
record and cannot appear here. Operational investigation and any provider-side
action remain outside this API.

## Schema basis and pagination decision

`payment_events` has immutable `provider_id` and `payment_id` as its primary key,
plus `building_id`, `session_id`, `amount_cents`, `currency`, `status` and
`disposition`. It has no event-created timestamp or monotonic sequence. The
existing append-only trigger prevents updating/deleting committed events. Order
ascending by `(provider_id, payment_id)` using PostgreSQL's column comparison and
matching `ORDER BY` under the database's existing collation. Use the primary-key
index and keyset predicate `(provider_id, payment_id) > (cursor.providerId,
cursor.paymentId)`; never use OFFSET, add an explicit `COLLATE`, or sort payment
IDs in JavaScript. The PostgreSQL 17 test catalog confirms both columns and both
primary-key index keys use the same deterministic `default` collation
(`en_US.utf8` for that database) with `text_ops`. A read-only query with valid
Unicode payment IDs confirmed that the tuple comparison agrees with `ORDER BY`;
`EXPLAIN` used the existing primary-key index for the keyset condition. Thus the
predicate, sort and index use consistent database ordering without a new index.

Each request reads one committed-state snapshot. Exactly-once traversal applies
only to rows that **matched the building/disposition filter and were committed
before the first page**: their keys and filter fields are immutable, so concurrent
inserts cannot shift, remove or duplicate them across continuation pages. This
does **not** make the multi-request traversal a frozen snapshot. A newly committed
key ahead of the cursor may appear, while one behind it will not appear until a
fresh traversal. Never advertise a complete as-of-time audit or use this view as
a sole real-time alert. No timestamp
or sequence is invented to imply insertion order. A fresh first-page scan starts
without a cursor.

## HTTP contract

`GET /operations/payment-exceptions` over HTTPS. Exactly one
`Authorization: Bearer <operator-secret>` header is required. Optional query
parameters are `limit` and `cursor`; reject repeated or unknown parameters.
`limit` is an ASCII decimal integer from 1 through 100, with no sign, whitespace
or leading zeroes; default 50. `cursor` is an opaque base64url token without
padding, at most **1082 ASCII characters**. Generate it by UTF-8 encoding the
compact `JSON.stringify` result of an object whose keys are inserted in exactly
this order: `v`, `providerId`, `paymentId`; values are `1`, `pilot` and the exact
stored payment ID. Do not add spaces, escape valid non-ASCII characters manually,
or normalize the ID. Base64url-encode those bytes without padding. This fixes
serialization across instances. Decode using strict base64url and UTF-8; require
the decoded JSON to have exactly `{"v":1,"providerId":"...","paymentId":"..."}`.
Both IDs must be nonempty,
well-formed for their existing database columns: provider ID is the existing
PB-05 pilot identity (`pilot`) and payment ID is at most 128 Unicode code points,
excluding NUL and unpaired surrogates, as in PB-05. Reject malformed UTF-8/JSON,
unknown fields, invalid version/IDs or invalid base64url with 400. Cursor text is
not a credential; never log it. The server creates tokens only from returned keys.
An otherwise valid cursor key need not still designate a matching exception row;
it is an exclusive position in the immutable key order.

The empty-ID compact JSON is 43 UTF-8 bytes. JSON serialization uses at most six
UTF-8 bytes for each valid payment-ID code point (for example U+0001 becomes
`\u0001`); valid supplementary characters use four bytes, and NUL/unpaired
surrogates are excluded. At 128 code points the maximum is `43 + 128 × 6 = 811`
bytes, whose unpadded base64url encoding is `4 × ceil(811 / 3) − 2 = 1082`
characters. A server-generated cursor therefore fits the input limit exactly.
Reject any client-supplied cursor longer than 1082 characters before decoding;
within the limit, malformed encoding or content still returns 400.

On success return `200 application/json` and `Cache-Control: no-store`:

```json
{
  "items": [
    {
      "providerId": "pilot",
      "paymentId": "pay_123",
      "parkingSessionId": "550e8400-e29b-41d4-a716-446655440000",
      "amount": { "value": 1000, "currency": "EUR" },
      "status": "PAID",
      "disposition": "RECONCILIATION_REQUIRED"
    }
  ],
  "nextCursor": null
}
```

`pilot` is the existing provider identity, not a new identifier. Return only the
listed fields. Filter by the trusted pilot
building and disposition. Fetch `limit + 1` rows; when an extra row exists,
`nextCursor` encodes the last **returned** row's key. Otherwise it is `null`.
Empty results use `items: []` and `nextCursor: null`. Amounts are safe integer
cents; currency is the originally recorded three-letter code, which may differ
from EUR for an unexpected event. Do not join or expose plates, gate credentials,
signatures, raw webhook bodies, resident status or session charge. No event time
is returned because none is recorded.

## Authentication, errors and failure behavior

Configure one high-entropy operator bearer secret outside version control, distinct
from every gate secret and `WEBHOOK_SECRET`. Use a dedicated setting
`OPERATOR_CREDENTIAL` with 32–256 printable ASCII characters; an unset/empty or
invalid setting disables operator access (fail closed), without blocking public
occupancy or gate/payment endpoints. Compare supplied credentials securely and
perform authentication before query parsing or database access for this GET route.
Do not echo or log credentials, cursor content or payment/session identifiers.
Only an authenticated operator can see rows; gate and provider credentials return
401. This single-role pilot credential does not introduce user accounts or RBAC.

Use the existing `{ "error": { "code": "...", "message": "..." } }` envelope,
with safe generic messages and `Cache-Control: no-store` on all responses:

| HTTP | Code | Condition |
| --- | --- | --- |
| 400 | INVALID_REQUEST | Bad, duplicate or unknown query parameter; malformed/invalid cursor. |
| 401 | UNAUTHENTICATED | Missing, duplicate or invalid bearer credential; operator setting unavailable. |
| 503 | EXCEPTIONS_TEMPORARILY_UNAVAILABLE | Pool/database unavailable or bounded read timeout; retry the same page. |
| 500 | INTERNAL_ERROR | Unexpected failure; no sensitive details disclosed. |

No 404 for an empty page. A failed page has no mutation and no advanced cursor.
The caller retries with its last successful cursor. Read from committed database
state without locks on payment/session/allocation rows; do not hold a transaction
across HTTP requests. Use the project's bounded database waits. The response is
advisory operational visibility, not proof of provider-side payment outcome.

## Acceptance criteria and test strategy

- HTTP: operator credential succeeds; missing, malformed, duplicate, gate and
  provider credentials fail 401 without database reads. No response/log leaks
  sensitive fields. All success/error responses have `no-store`.
- Validation: default/min/max limits; reject zero, 101, signs, whitespace, leading
  zeroes, repeated/unknown parameters, malformed/oversized/base64-invalid cursor,
  invalid version/shape/IDs and invalid UTF-8 with 400. Verify deterministic,
  compact key order and unpadded base64url encoding.
- Data: include only committed pilot-building `RECONCILIATION_REQUIRED` rows;
  exclude SETTLED, FAILED and any other building. Preserve original payment IDs,
  amounts and currencies; return exactly the specified fields and no timestamp.
- Pagination: real PostgreSQL test with keys deliberately out of lexical arrival
  order, Unicode IDs and page sizes 1/2/100; assert deterministic ordering, no
  repeated or skipped **pre-existing** rows and correct terminal `null`. Insert
  keys both ahead of and behind the cursor between pages; verify documented
  visibility and that a fresh traversal can find the behind-cursor insert.
- Cursor bound regression: store a valid 128-code-point payment ID consisting of
  U+0001, return it at the end of a nonterminal page, and verify the generated
  cursor is 1082 characters, decodes to the identical ID, is accepted by the next
  request and continues to the following row. A longer client cursor and malformed
  tokens at or below the limit return 400.
- Failure and invariants: database outage/timeout maps to retryable 503; unexpected
  error is sanitized 500. Reads leave payment events, sessions and allocations
  unchanged. Existing PB-05 duplicate and post-completion PAID tests still pass;
  identical webhook redelivery produces one listed event, not another exception.

Use focused unit tests for cursor/validation and HTTP tests for authentication and
privacy. Use real PostgreSQL for ordering, filtering, concurrent insert visibility
and unchanged state. Run repository build, lint and relevant tests when this future
feature is implemented; these are planned checks, not execution evidence here.

## Assumptions and remaining external limits

The approved documentation direction chooses one configured operator secret for
the pilot; its exact secret is deployment configuration, not specification data.
The operator must start a fresh scan to see newly inserted keys behind a cursor.
The supplied provider contract offers no refund/reconciliation operation, and the
gate contract offers no payment-success delivery mechanism. Neither is needed to
implement this read-only endpoint. The API cannot reveal rejected pre-checkout
events because PB-05 intentionally does not store them.
