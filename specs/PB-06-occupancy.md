# PB-06: Public occupancy

Status: approved on 2026-11-12; implemented in `20fa83f` after the specification
was committed. See the [journal](../JOURNAL.md) for subsequent verification.
Sources: [brief](../BRIEF.md), [architecture](../docs/architecture.md),
[PB-03](PB-03-check-in.md), approved [shared lifecycle](PB-04-check-out.md#shared-lifecycle).

## Contract and responsibility

Confirmed: public read access to space occupancy. Approved architecture keeps this
operation within Parking, backed by committed PostgreSQL allocation state.

`GET /occupancy`, no authentication, returns `200 application/json` with an array
of all 150 pilot spaces ordered by ascending ID. Approved shape extends the brief's
illustrative response to avoid assigning a single vehicle type to resident spaces:

```json
[
  { "parkingSpaceId": 1, "eligibleFor": "RESIDENT", "vehicleTypes": ["CAR", "MOTOR"], "isOccupied": false },
  { "parkingSpaceId": 51, "eligibleFor": "VISITOR", "vehicleTypes": ["CAR"], "isOccupied": true },
  { "parkingSpaceId": 131, "eligibleFor": "VISITOR", "vehicleTypes": ["MOTOR"], "isOccupied": false }
]
```

Example is abbreviated; real responses include every space. IDs 1–50 use the
approved provisional resident CAR/MOTOR eligibility; 51–130 visitor CAR; 131–150
visitor MOTOR. Unknown query parameters are rejected with 400 INVALID_REQUEST.
Do not expose plate, session/payment identifiers, resident identity or credentials.

## Occupancy semantics

Occupancy reflects logical allocation, not physical sensor evidence. Under the
approved lifecycle, PARKED and AWAITING_PAYMENT retain allocation; COMPLETED
releases it after exact payment or zero-charge checkout. Payment failure does not
free a space; duplicate events do not change occupancy. Release and session changes
are atomic, using PB-03's building-lock protocol. A completed vehicle may remain
physically present briefly: this endpoint must not claim sensor-level accuracy.

Return one consistent committed-state snapshot without partial transaction effects.
Public reads do not acquire the building allocation lock; use a consistent database
read snapshot rather than blocking allocation/release through that lock.
Use direct reads, no additional projection store/cache. Approved `Cache-Control:
no-store` avoids deliberately serving stale capacity. The result is advisory and
may change immediately; it is not a reservation. A full result never changes the
terminal PARKING_FULL replay for an old PB-03 event. A new admission requires a
new vehicle event/UUID and still goes through normal allocation checks.

Errors use PB-03's envelope: 400 INVALID_REQUEST, 503 OCCUPANCY_TEMPORARILY_UNAVAILABLE
for transient database failure, 500 INTERNAL_ERROR without internal details.

## Essential acceptance tests

- Public unauthenticated response; all IDs exactly once, correct ranges/types,
  ordering, booleans and no sensitive fields.
- HTTP tests explicitly assert `Cache-Control: no-store` and 400 INVALID_REQUEST
  for unknown query parameters.
- Check-in occupies one space; positive checkout and FAILED retain it; completed
  paid/zero-charge sessions release once under the approved shared lifecycle.
- Real PostgreSQL/separate connections: uncommitted allocation/release is invisible,
  rollback causes no change, and committed completion/allocation is read consistently.
- Old full-request replay remains 409 after occupancy improves; a fresh admission
  event may allocate. No display response guarantees availability at check-in.

The shared lifecycle/release point and public logical occupancy contract are
approved. Gate payment notification and physical departure detection are
outside this public API; the former remains an external integration question.
This specification preceded implementation in Git history. Tests are implemented;
the [journal](../JOURNAL.md) records actual executions and results.
