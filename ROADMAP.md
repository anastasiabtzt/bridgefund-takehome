# ParkingBusiness pilot roadmap (PB-07)

This roadmap separates business urgency from readiness to implement. The pilot serves
one Amsterdam building. Its backend can complete sessions after verified payment,
but the supplied gate contract does not say how an exit controller learns that fact.
Priorities are proposals for the next business discussion, not approved feature contracts.

| Priority | User story and value | Readiness, dependencies and pilot scope |
| --- | --- | --- |
| P0 | **Exit authorization:** As a driver, I want the exit gate to recognize confirmed payment so I can leave without staff intervention. | **Blocked on an explicit gate-vendor contract.** Confirm the supported payment-success delivery/correlation mechanism, timeout and retry behavior, and what the gate does after a free checkout. The notes define gate-initiated HTTPS requests and action on a 2xx, but no push, poll, callback or barrier-command API. Do not claim end-to-end opening from checkout 200 or webhook 204. |
| P1 | **Resident entitlement verification:** As the operator, I want free resident parking restricted to entitled vehicles so visitor revenue and resident capacity are protected. | **Needs a trusted entitlement source and policy.** Today `isResident` is a gate assertion, not verification. Define who maintains entitlements, plate matching, expiry, outages and disputes before a spec. Keep the pilot's existing allocation rules until then. |
| P1 | **Payment Exception Review:** As an operator, I want to see payment events already flagged for reconciliation so I can investigate possible duplicate or unexpected payments. | **Ready for specification:** [PB-07 Payment Exception Review](specs/PB-07-payment-exception-review.md). A read-only operator view over existing immutable records; no refunds, adjustments or new payment states. It does not recover events rejected before checkout. |
| P2 | **Multi-building support:** As ParkingBusiness, I want each building to use its own layout and tariff so a proven pilot can expand. | Wait for a second building's actual layout, tariff, timezone and credential operations. The model carries building IDs, but seed/configuration and business rules are currently pilot-specific. |
| P3 | **Dynamic pricing:** As ParkingBusiness, I want configurable prices when there is evidence that changing tariffs improves utilization or revenue. | Defer until pricing goals and authorization are established. Any policy must preserve frozen checkout charges and Amsterdam calendar-day semantics; no tariff administration is in this pilot. |

## External questions and exclusions

- Ask the gate vendor how the exit controller learns durable payment success, ties it
  to the current vehicle event and handles delayed/duplicate responses. The existing
  notes do not authorize an integration design.
- Resolve the legacy-terminal path with the provider/vendor: unsigned
  `X-Legacy-Exit` calls cannot establish trusted payment and are rejected by the pilot.
- Obtain an authoritative resident-entitlement source and outage policy before
  changing free-parking decisions.
- Payment initiation, physical departure sensing, barrier control, refunds, queues,
  multi-building administration and dynamic-pricing infrastructure are outside the
  selected read-only specification.

Sources: [brief](BRIEF.md), [gate notes](docs/gates.md),
[provider notes](docs/payment-provider.md), [architecture](docs/architecture.md)
and [current limits](README.md).
