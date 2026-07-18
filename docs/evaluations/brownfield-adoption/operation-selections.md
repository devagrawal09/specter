# Brownfield Operation Selections

Published 2026-07-18 before scored adoption work. This record applies the
required gates and six scoring dimensions in
`operation-selection-rubric.md` to the frozen source, fixtures, and executable
tests. It records operation eligibility; it is not a substitute for the later
live baseline or scored acceptance report.

## Score summary

The dimension columns are state-machine clarity (state), compatibility
evidence (compat), existing coverage (coverage), bootstrap quality (bootstrap),
background-work relevance (background), and scope containment (scope).

| Target | Selected public operation | Frozen revision | Preparation revision | State | Compat | Coverage | Bootstrap | Background | Scope | Total |
| --- | --- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| PostgreSQL Work Orders | `POST /work-orders/:id/close` | `a131c2e1ea9d80fc0c1affdd72f9983712c35e0b` | — | 2 | 2 | 2 | 2 | 2 | 2 | 12 |
| Mongo Returns | `POST /returns/:id/approve-refund` | `a4b21a424f43c6fc2f25f1074217be8ea44d97db` | — | 2 | 2 | 2 | 2 | 2 | 2 | 12 |
| MySQL Shipments | `POST /shipments/:id/dispatch` | `057fa263d32cd79f3827f071a06639a15e2f6667` | — | 2 | 2 | 2 | 2 | 2 | 2 | 12 |
| Outline | `POST /api/accessRequests.create` | `d2bf2b8c5a208884b9662dad72244ca8d8924c14` | `1e63d0bead1d33e9f91378d8ac27c407923b8f89` | 1 | 1 | 2 | 2 | 2 | 2 | 10 |
| Karakeep | `POST /api/trpc/lists.addToList` | `bc50630767079b060488d1d790b96de1e06ea6ba` | `ca48579b7c1e22016e6ca00bfaf91c3fdc84f949` | 2 | 2 | 2 | 1 | 2 | 2 | 11 |

The non-2 scores have concrete limits:

- Outline state-machine clarity is 1 because the accepted transition is in
  `server/routes/api/accessRequests/accessRequests.ts`, while duplicate-pending
  rejection is a `BeforeCreate` hook in `server/models/AccessRequest.ts` and
  existing-access rejection depends on the policy layer. The complete decision
  is inspectable, but not local to one operation boundary.
- Outline compatibility evidence is 1 because
  `POST /api/accessRequests.info` is the one direct unchanged public reader of
  the newly created pending request. Its ID and document-ID lookup modes do not
  constitute multiple independent readers.
- Karakeep bootstrap quality is 1 because the available fixed archive contains
  3 users, 24 bookmarks, 8 lists, and 24 memberships and must be migrated from
  its older source revision before use. It supplies meaningful accepted and
  rejected records, but is broader than a small operation-owned snapshot.

## PostgreSQL Work Orders

Selection: `POST /work-orders/:id/close` at
`a131c2e1ea9d80fc0c1affdd72f9983712c35e0b`. The public route and Zod request
schema are in `src/app.ts`; the persisted transaction is in `src/store.ts`; and
the decision is in `src/domain/work-order.ts`.

1. **Public validated contract — pass.** Fastify exposes the route through the
   existing HTTP application. `paramsSchema` validates `WO-0000` identifiers,
   and strict `closeSchema` validates the optional body and its `requestedBy`
   default.
2. **Persisted decision and rejection — pass.** `PostgresWorkOrderStore.close`
   locks the work-order row. `decideClose` accepts only `in_progress` with a
   passed inspection and rejects `ALREADY_CLOSED`, `INVALID_STATUS`, and
   `INSPECTION_REQUIRED`.
3. **Accepted and rejected legacy records — pass.** `src/seed.ts` supplies
   eligible `WO-1001`/`WO-1006` and rejected `WO-1002` through `WO-1005`,
   including every documented rejection class.
4. **Unchanged reader — pass.** `GET /work-orders`,
   `GET /work-orders/:id`, and `GET /work-orders/:id/history` observe the
   closed work order and history without transport changes.
5. **One-Command containment — pass.** The locked decision, state update,
   history append, and application-event insert already form one store
   transaction behind the route. Readers and the service's existing lack of an
   authentication layer do not need redesign.
6. **Executable public-contract coverage — pass.** `test/http.test.ts` freezes
   validation, success, all rejection envelopes, missing resources, and reader
   parity; `test/domain.test.ts` covers the policy; and
   `test/live/postgres.test.ts` covers atomicity and concurrency.
7. **No unavailable SaaS credential — pass.** The consequence uses the local
   PostgreSQL application-event table and pg-boss worker. It requires only the
   supplied PostgreSQL service.

## Mongo Returns

Selection: `POST /returns/:id/approve-refund` at
`a4b21a424f43c6fc2f25f1074217be8ea44d97db`. The route and strict Zod input are
in `src/app.ts`; the transaction is in `src/services/return-service.ts`; and the
decision is in `src/domain/refund-decision.ts`.

1. **Public validated contract — pass.** Express exposes the existing route,
   and its strict empty-object schema rejects caller-supplied refund decision
   data.
2. **Persisted decision and rejection — pass.** `ReturnService.approveRefund`
   rereads the return inside a MongoDB transaction and uses an optimistic
   version predicate. The policy rejects not received, not inspected, rejected
   inspection, and already refunded states.
3. **Accepted and rejected legacy records — pass.** `scripts/seed.ts` provides
   eligible `ret-1001`/`ret-1006` plus already refunded `ret-1002`, not received
   `ret-1003`, not inspected `ret-1004`, and rejected `ret-1005`.
4. **Unchanged reader — pass.** `GET /returns` and `GET /returns/:id` expose the
   state changed by approval without response-contract changes.
5. **One-Command containment — pass.** Refund approval already groups the
   guarded transition, approval, history, reminder cancellation, and durable
   job insert in one transaction. Existing readers and the service boundary can
   remain intact.
6. **Executable public-contract coverage — pass.**
   `tests/http/public-routes.test.ts` freezes success, validation, conflict, and
   reader envelopes; `tests/unit/refund-decision.test.ts` covers each guard; and
   `tests/live/replica-set.test.ts` covers rollback, concurrency, readers, and
   durable work.
7. **No unavailable SaaS credential — pass.** The selected path uses the local
   MongoDB replica set and Agenda job collection; its deterministic refund
   worker test does not require a payment-provider credential.

## MySQL Shipments

Selection: `POST /shipments/:id/dispatch` at
`057fa263d32cd79f3827f071a06639a15e2f6667`. The route is in `src/app.ts`, the
transaction is in `src/repository.ts`, and the decision is in `src/domain.ts`.

1. **Public validated contract — pass.** Hono exposes an existing parameterized
   route with no request body. The router supplies the string identifier and
   the store rejects an identifier with no persisted shipment as
   `404 NOT_FOUND`; there is no caller-controlled transition payload.
2. **Persisted decision and rejection — pass.** `MysqlShipmentStore.dispatch`
   locks the row and `assertCanDispatch` accepts only pending, paid, allocated
   shipments. It rejects invalid/repeated status, uncaptured payment, and
   unallocated inventory.
3. **Accepted and rejected legacy records — pass.** `src/seed.ts` supplies
   eligible `shp-ready-001`, unpaid `shp-payment-002`, unallocated
   `shp-inventory-003`, cancelled `shp-cancelled-004`, and already dispatched
   `shp-dispatched-005`.
4. **Unchanged reader — pass.** `GET /shipments`, `GET /shipments/:id`, and
   `GET /shipments/:id/history` independently observe the transition and its
   history.
5. **One-Command containment — pass.** The locked decision, shipment update,
   history append, and deterministic outbox insert are already one MySQL
   transaction. Existing readers need no migration and there is no unrelated
   authentication workflow to redesign.
6. **Executable public-contract coverage — pass.**
   `tests/public-routes.test.ts` freezes success and all error envelopes;
   `tests/domain.test.ts` covers the transition policy; and
   `tests/live-http.test.ts`/`tests/live-db.test.ts` cover fixed reader parity,
   persisted rejection, atomicity, and concurrency.
7. **No unavailable SaaS credential — pass.** Notification handoff uses the
   local MySQL outbox and Redis/BullMQ services only.

## Outline

Selection: `POST /api/accessRequests.create` at parent revision
`d2bf2b8c5a208884b9662dad72244ca8d8924c14`, with coordinator-only preparation
at `1e63d0bead1d33e9f91378d8ac27c407923b8f89`. The route is in
`server/routes/api/accessRequests/accessRequests.ts`, its input schema is in
`server/routes/api/accessRequests/schema.ts`, and duplicate-pending validation
is in `server/models/AccessRequest.ts`.

1. **Public validated contract — pass.** The existing Koa API route retains
   authentication, rate limiting, Zod validation of UUID-or-slug `documentId`,
   and transaction middleware.
2. **Persisted decision and rejection — pass.** The route reads the persisted
   document and authorization state, rejecting existing read access and
   cross-team access. The model hook queries persisted pending requests and
   rejects a duplicate before insert.
3. **Accepted and rejected legacy records — pass.**
   `specter-evaluation/legacy-snapshot.json` provides one private document, a
   fresh eligible requester, and a second requester with a fixed pending access
   request.
4. **Unchanged reader — pass.** `POST /api/accessRequests.info` retrieves the
   pending request by request ID or document ID/URL ID through the unchanged
   presenter and policy envelope.
5. **One-Command containment — pass.** The operation can place document lookup,
   guards, and access-request creation behind one Command while leaving Koa
   authentication, rate limiting, transaction middleware, the presenter, and
   the info route intact.
6. **Executable public-contract coverage — pass.**
   `server/routes/api/accessRequests/accessRequests.test.ts` covers validation,
   authentication, not found, success, existing access, URL IDs, duplicate
   pending requests, and reader behavior. The preparation adds
   `specter-evaluation/coordinator-acceptance.test.ts` for fixed-snapshot
   success, rejection, reader parity, and the notification consequence.
7. **No unavailable SaaS credential — pass.** Creation records an
   `access_requests.create` event; the local Notifications processor/task can
   persist its manager Notification without running the later external email
   delivery boundary.

## Karakeep

Selection: `POST /api/trpc/lists.addToList` at parent revision
`bc50630767079b060488d1d790b96de1e06ea6ba`, with coordinator-only preparation
at `ca48579b7c1e22016e6ca00bfaf91c3fdc84f949`. The tRPC procedure is in
`packages/trpc/routers/lists.ts`; manual and smart list behavior is in
`packages/trpc/models/lists.ts`.

1. **Public validated contract — pass.** The existing tRPC-over-Hono mutation
   validates `listId` and `bookmarkId` with Zod and retains authenticated list
   scope, viewer, editor, and bookmark-ownership middleware.
2. **Persisted decision and rejection — pass.** The procedure loads the
   persisted list subtype. A manual list inserts the membership; a smart list
   rejects with `BAD_REQUEST` and `Smart lists cannot be added to`. A duplicate
   manual add is a successful no-op.
3. **Accepted and rejected legacy records — pass.**
   `specter-evaluation/legacy-snapshot.json` identifies an unjoined manual list,
   a rejected smart list, an owned bookmark, and an existing baseline
   membership in the fixed archive.
4. **Unchanged reader — pass.** `lists.getListsOfBookmark`,
   `bookmarks.getBookmarks({ listId })`, `lists.get`, `lists.stats`, and the
   existing list-management UI observe the same membership.
5. **One-Command containment — pass.** The membership decision and write can
   move behind one Command while leaving all tRPC authentication/authorization
   middleware and the independent readers intact.
6. **Executable public-contract coverage — pass.**
   `packages/trpc/routers/lists.test.ts` covers add/remove, smart-list
   rejection, readers, and Rule Engine triggering;
   `packages/trpc/routers/sharedLists.test.ts` covers editor/viewer
   authorization; and `specter-evaluation/list-operation.acceptance.test.ts`
   freezes idempotency, reader parity, rejection, and one-event behavior.
7. **No unavailable SaaS credential — pass.** The consequence is the local
   Liteque SQLite `rule_engine_queue` and Rule Engine worker. The prepared queue
   probe uses a local missing-bookmark event and requires no external service.
