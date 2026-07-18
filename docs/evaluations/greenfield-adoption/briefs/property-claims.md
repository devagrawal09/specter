# Product Brief: Property-Insurance Claims

## Objective

Build a property-claim workbench spanning first notice of loss, evidence,
coverage and reserve assessment, fraud review, adjudication, settlement,
payment, denial, and appeal. Guard financial transitions, make automatic fraud
referral durable and retry-safe, and keep adjuster queues live.

This is a replication domain. The required behavior is public product behavior,
not an internal model: choose your own Event vocabulary, Slice names, feature
boundaries, private State, and projection design.

## Assigned environment

- Persistence: maintained SQLite Event Log, Slice Store, and durable outbox
  against a real on-disk database.
- Topology: one application/web process on strict port `41913`.
- Recovery: generate and adapt the shipped SQLite persistent harness; do not
  replace the assigned adapters or scheduler.

## Boundary-owned fixture values

| Meaning | Value |
|---|---|
| High-risk claim | `claim-pc-301` |
| Low-risk claim | `claim-pc-302` |
| Policies | `policy-pc-301`, `policy-pc-302` |
| Evidence | `evidence-pc-301` |
| Fraud referral | `referral-pc-301` |
| Settlement | `settlement-pc-301` |
| Payment | `payment-pc-301` |
| Appeal | `appeal-pc-302` |
| Loss times | `2026-08-05T03:15:00.000Z`, `2026-08-05T05:45:00.000Z` |
| Notice times | `2026-08-05T12:00:00.000Z`, `2026-08-05T12:15:00.000Z` |
| Later actions | ISO values from `2026-08-05T13:00:00.000Z` onward |

The initiating request supplies all IDs, timestamps, amounts, scores, and
appeal/referral identifiers. Handlers do not generate domain values.

## Required product behavior

1. Record first notice of loss with claim/policy IDs, claimant, property,
   cause, claimed amount in whole cents, loss time, and notice time. Duplicate
   claim IDs are rejected as `Claim already exists`.
2. Add uniquely identified evidence with type, summary, source, and received
   time. Evidence cannot be added after final payment unless an appeal has
   reopened review.
3. Record coverage outcome, reserve amount, fraud score from 0 through 100, and
   assessment time. Coverage denial requires a reason. Negative reserves and a
   second current assessment are rejected.
4. Open and later clear a special-investigation referral. Approval is rejected
   as `Fraud review must be cleared` while a referral remains open.
5. Approve or deny adjudication. Approval requires covered status and a reserve
   sufficient for the approved amount. Denial records a reason. A decided claim
   cannot receive another decision unless reopened through appeal.
6. For an approved claim, record settlement acceptance, authorize payment no
   greater than the accepted settlement, then confirm that uniquely identified
   payment. Duplicate authorization or confirmation must not pay twice.
7. Appeal a denied claim with appeal ID, grounds, and received time. One active
   appeal reopens the claim into review; the same denial cannot accumulate
   duplicate active appeals.

Accepted operations expose a committed receipt through the public envelope
transport. Rejected and invalid operations append no domain facts and surface a
stable structured error with the exact message where specified.

## Checkpoint operation

The vertical-path checkpoint is **coverage and reserve assessment**. Demonstrate
acceptance after first notice, rejection for an unknown claim, and rejection of
a second current assessment. Include exact prior-history Scenarios, runtime
schemas, private decision State, a work-queue Query, public transport, and
visible UI on `41913`.

## Required asynchronous effect

An accepted assessment at or above fraud score `75` schedules durable work that
submits the normal guarded operation opening the supplied `referralId`. Use the
retry-stable delivery identity as the downstream idempotency key. The referral
must be unique for the assessment across duplicate delivery, retry, and restart.

Assessment commit and reaction completion are shown separately. A first-attempt
effect failure remains operationally visible and can be retried after restart;
successful recovery neither loses the referral nor creates a second one.

## Operational views and live behavior

Provide a work queue with claim/policy ID, claimant, claimed amount, coverage,
reserve, fraud status, adjudication, payment status, and last activity time.
Support search and filters for workflow status, fraud-review state, and coverage.
A claim detail view shows evidence, assessment, referral, decision, settlement,
payment, and appeal history.

When a high-risk assessment is submitted by a second request, an already-open
queue subscription must show the changed fraud state and then the automatic
referral without manual refresh.

## Persistence, replay, concurrency, and idempotency

- Stop and restart the process against the same SQLite file; decision State and
  views must catch up to an equivalent result.
- Clear or lag a projection and repair it by replay without rewriting history.
- Two authorization attempts at the same observed claim version must not both
  succeed or produce aggregate authorization above the accepted settlement.
- Repeating payment confirmation with one idempotency key returns the original
  receipt and leaves exactly one payment.
- Injected failure between projection apply and cursor publication is atomic or
  safely repeatable.

## Browser journeys

### Journey A: high-risk approval and payment

Create `claim-pc-301`, add evidence, and record covered assessment with fraud
score `90`. Observe the live automatic referral. Attempt approval and see
`Fraud review must be cleared`; clear the review, approve within reserve, accept
settlement, authorize payment, and confirm `payment-pc-301`. Restart and verify
the paid detail remains equivalent.

### Journey B: denial, appeal, and reopened queue

Create and assess `claim-pc-302` at low fraud risk, deny it, then submit
`appeal-pc-302`. Verify the claim returns to active review, a duplicate appeal
does not create another active case, and queue filters distinguish reopened
claims from paid claims.

## Visible acceptance

The visible suite covers focused and whole-app Scenarios, public transport,
live updates, on-disk restart/replay, and both browser journeys. Run:

```sh
npm run check
npm run lint
npm run typecheck
npm run test
npm run build
npm run test:e2e:preflight
npm run test:e2e
```

Held-out checks add duplicate payment/idempotency probes, authorization races,
cursor failure recovery, outbox failure/restart/dead-letter behavior, malformed
transport envelopes, and subscription cleanup.
