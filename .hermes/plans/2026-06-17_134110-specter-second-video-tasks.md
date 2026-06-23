# Specter Second Video Tasks Implementation Plan

> **For Hermes:** Use subagent-driven-development skill to implement this plan task-by-task.

**Goal:** Finish every Nexus task needed to record Specter’s second video: reliable WSL tooling, publish-ready packages, verified starter flow, lifecycle fixes, public/agent workflow docs, an inventory reference demo with low-stock reaction, UI smoke path, and final recording readiness.

**Architecture:** Work in `/home/lucifer/work/active/specter` on WSL. Use `apps/booking-reference` and `apps/reference` as implementation templates, keep slice-owned state private, write scenarios/tests before implementation, and verify with filtered `pnpm` commands before root release verification. Preserve unrelated `.opencode/agent/*.md` modifications.

**Tech Stack:** TypeScript, pnpm workspaces, Specter core, Solid UI, Vite, Drizzle/SQLite, Vitest, Biome, Playwright, npm publishing.

---

## Context

- Repo: `/home/lucifer/work/active/specter`
- Avoid touching/staging existing unrelated changes:
  - `.opencode/agent/intern.md`
  - `.opencode/agent/junior.md`
  - `.opencode/agent/senior.md`
- Second-video Nexus tasks:
  - install native Node and pnpm in WSL Specter workspace
  - fix booking-reference stale lifecycle read models
  - document Specter slice authoring workflow for agents
  - build Specter inventory reference demo app
  - add inventory low-stock reaction demo
  - add inventory UI demo path and smoke test
  - publish Specter 0.2.2 packages for video demo
  - verify create-specter install dev test flow for video
  - record Specter second video
- Current findings:
  - WSL lacks native `node`/`pnpm`; `npm` resolves to a Windows/Hermes path.
  - `@specter-ts/core` and `create-specter` are versioned `0.2.2`.
  - `packages/create-specter/template/package.json` depends on `@specter-ts/core: 0.2.2`.
  - Release scripts exist: `pnpm release:auth`, `release:verify`, `release:pack`, `release:dry-run`, `release:publish`.
  - Public docs are sparse; `CONTEXT.md` and `.agents/skills/specter/SKILL.md` are the workflow/terminology sources.

## Constraints

1. Do not publish until local verification, tarball smoke, and dry-run publish pass.
2. Ask for explicit approval before real `pnpm release:publish`.
3. Use TDD/scenarios for code changes.
4. Keep starter-template agent guidance in sync with repo-level guidance.
5. Treat reaction slices as returning effect payloads via a plugin, not directly emitting events.

---

## Phase 0 — Tooling unblock

### Task 1: Install native Node and pnpm in WSL

**Objective:** Make the repo runnable entirely from WSL.

**Files:** none expected.

**Steps:**
```bash
cd /home/lucifer/work/active/specter
command -v node || true
command -v npm || true
command -v pnpm || true
echo "$PATH"
```
Install Node LTS in WSL using the user’s preferred method, then:
```bash
corepack enable
corepack prepare pnpm@11.1.3 --activate
node -v
npm -v
pnpm -v
pnpm install --frozen-lockfile
```

**Validation:** `node -p "process.platform + ' ' + process.execPath"` reports `linux` and a Linux path; pnpm is `11.1.3`; install succeeds.

---

## Phase 1 — Stabilize booking-reference

### Task 2: Add failing lifecycle scenarios

**Objective:** Capture stale command read-model bugs before fixing them.

**Files:**
- `apps/booking-reference/src/features/bookings/scenarios.test.ts`
- possibly slice-local scenarios in `apps/booking-reference/src/features/bookings/*/slice.ts`

**Scenarios:**
1. Canceled booking no longer blocks same room/time `requestBooking`.
2. Rejected booking no longer blocks `requestBooking`.
3. Released booking no longer blocks `requestBooking`.
4. Canceled/rejected/released booking no longer blocks `retireRoom`.
5. Canceled/rejected booking cannot later be approved or checked in.
6. Approved/canceled booking cannot be rejected incorrectly.
7. Approval notification recording is idempotent or guarded.

**Verify failure:**
```bash
pnpm --filter @specter/booking-reference test -- --run
```

### Task 3: Fix lifecycle projections

**Objective:** Make command slice local state converge with the event log.

**Files:**
- `apps/booking-reference/src/features/bookings/request-booking/slice.ts`
- `apps/booking-reference/src/features/bookings/retire-room/slice.ts`
- `apps/booking-reference/src/features/bookings/reschedule-booking/slice.ts`
- `apps/booking-reference/src/features/bookings/cancel-booking/slice.ts`
- `apps/booking-reference/src/features/bookings/approve-booking/slice.ts`
- `apps/booking-reference/src/features/bookings/reject-booking/slice.ts`
- `apps/booking-reference/src/features/bookings/check-in-booking/slice.ts`
- `apps/booking-reference/src/features/bookings/record-approval-notification/slice.ts`

**Guidance:** apply all lifecycle events that affect local decision state. Only active pending/approved/checked-in reservations should block booking/retirement; rejected/canceled/released should not.

**Validation:**
```bash
pnpm --filter @specter/booking-reference test -- --run
pnpm --filter @specter/booking-reference typecheck
pnpm --filter @specter/booking-reference build
```

**Commit:** `git commit -m "fix: refresh booking lifecycle read models"`

---

## Phase 2 — Document workflow

### Task 4: Add public slice-authoring workflow doc

**Files:**
- Create `docs/slice-authoring-workflow.md`
- Modify `README.md`
- Reference `CONTEXT.md`

**Include:** Specter mental model, events as facts, command/query/reaction slices, private slice state, scenarios as executable docs, registry wiring, schema exports/migrations, typed client UI wiring, boundary rules.

### Task 5: Sync agent guidance

**Files:**
- `.agents/skills/specter/SKILL.md`
- `packages/create-specter/template/.agents/skills/specter/SKILL.md`
- optionally `packages/create-specter/template/src/features/todos/README.md`

**Validation:**
```bash
pnpm lint
pnpm typecheck
pnpm --filter create-specter typecheck
pnpm --filter create-specter build
```

**Commit:** `git commit -m "docs: add Specter slice authoring workflow"`

---

## Phase 3 — Inventory reference app

### Task 6: Scaffold `apps/inventory-reference`

Copy the proven shape from booking/reference.

**Create:**
- `apps/inventory-reference/package.json`
- `apps/inventory-reference/vite.config.ts`
- `apps/inventory-reference/drizzle.config.ts`
- `apps/inventory-reference/src/server.ts`
- `apps/inventory-reference/src/client.tsx`
- `apps/inventory-reference/src/specter-client.ts`
- `apps/inventory-reference/src/reaction-scheduler.ts`
- `apps/inventory-reference/src/db/schema.ts`
- `apps/inventory-reference/src/db/specter-schema.ts`
- `apps/inventory-reference/src/db/specter-sqlite.ts`
- `apps/inventory-reference/src/db/scenario-tests.ts`
- slice-import check scripts

Use package name `@specter/inventory-reference`.

### Task 7: Define inventory events and registry

**Create:**
- `apps/inventory-reference/src/features/inventory/events.ts`
- `apps/inventory-reference/src/features/inventory/registry.ts`
- `apps/inventory-reference/src/features/inventory/scenarios.test.ts`

**Events:** `itemCreated`, `reorderThresholdSet`, `stockReceived`, `stockReserved`, `reservationReleased`, `reservationShipped`, `stockAdjusted`, `lowStockAlertRecorded`.

### Task 8: Implement command slices

**Create slices:**
- `create-item`
- `set-reorder-threshold`
- `receive-stock`
- `reserve-stock`
- `release-reservation`
- `ship-reservation`
- `adjust-stock`
- `record-low-stock-alert`

**Validation:**
```bash
pnpm --filter @specter/inventory-reference test -- --run
pnpm --filter @specter/inventory-reference typecheck
```

### Task 9: Implement query slices

**Create:**
- `inventory-dashboard-query/slice.ts`
- `low-stock-items-query/slice.ts`
- `stock-ledger-query/slice.ts`

Outputs: dashboard quantities, low-stock items, ordered stock/activity ledger.

### Task 10: Generate migrations

```bash
pnpm --filter @specter/inventory-reference db:generate
pnpm --filter @specter/inventory-reference test -- --run
```

**Commit:** `git commit -m "feat: add inventory reference command and query slices"`

---

## Phase 4 — Low-stock reaction

### Task 11: Add failing reaction scenarios

Scenarios:
1. Crossing below threshold returns one `recordLowStockAlert` effect payload.
2. Replaying same low-stock state returns no duplicate effect.
3. Receiving stock above threshold resets the episode.
4. Dropping below threshold again returns a new effect.
5. Items with no threshold do not alert.

### Task 12: Implement reaction and alert recording

**Files:**
- `apps/inventory-reference/src/features/inventory/low-stock-reaction/slice.ts`
- `apps/inventory-reference/src/features/inventory/record-low-stock-alert/slice.ts`
- registry and scheduler if needed

**Validation:**
```bash
pnpm --filter @specter/inventory-reference test -- --run
pnpm --filter @specter/inventory-reference typecheck
pnpm --filter @specter/inventory-reference build
```

**Commit:** `git commit -m "feat: add inventory low stock reaction demo"`

---

## Phase 5 — UI path and smoke test

### Task 13: Build inventory UI demo path

**Files:**
- `apps/inventory-reference/src/inventory-app.tsx`
- `apps/inventory-reference/src/client.tsx`
- `apps/inventory-reference/src/server.ts`
- `apps/inventory-reference/src/specter-client.ts`

**Path:** seed product → receive stock → reserve stock → over-reservation failure → ship/release → low-stock notification → ledger.

### Task 14: Add Playwright smoke test

**Files:**
- `apps/inventory-reference/playwright.config.ts`
- `apps/inventory-reference/tests/e2e/inventory.spec.ts`
- `apps/inventory-reference/package.json`

**Validation:**
```bash
pnpm --filter @specter/inventory-reference test:e2e
pnpm --filter @specter/inventory-reference test -- --run
pnpm --filter @specter/inventory-reference typecheck
pnpm --filter @specter/inventory-reference build
```

**Commit:** `git commit -m "feat: add inventory demo UI smoke path"`

---

## Phase 6 — Release verification

### Task 15: Add inventory to root scripts

**Files:** `package.json`, maybe `pnpm-lock.yaml`.

**Validation:**
```bash
pnpm test
pnpm typecheck
pnpm build
pnpm lint
```

### Task 16: Verify local tarballs and starter flow

```bash
pnpm release:verify
pnpm release:pack
rm -rf /tmp/specter-smoke
SPECTER_CORE_SPEC=file:/tmp/opencode/specter-ts-core-0.2.2.tgz pnpm --filter create-specter exec create-specter /tmp/specter-smoke --force
cd /tmp/specter-smoke
npm install
npm run test
npm run typecheck
npm run build
```

### Task 17: Dry-run publish and publish

```bash
pnpm release:auth
pnpm release:dry-run
```
Then, only after explicit approval:
```bash
pnpm release:publish
```
Post-publish smoke:
```bash
rm -rf /tmp/specter-published-smoke
cd /tmp
npm create specter@latest specter-published-smoke -- --yes
cd /tmp/specter-published-smoke
npm install
npm run test
npm run typecheck
npm run build
```

---

## Phase 7 — Recording readiness

### Task 18: Update second video script

**Files:** preferred repo doc `docs/second-video-script.md`; or update Nexus `D:/nexus/docs/Specter second video WIP script.md`.

Replace placeholders with actual inventory events/slices/commands and exact terminal/UI flow. No `<...>` placeholders should remain.

### Task 19: Dress rehearsal

```bash
pnpm release:verify
pnpm --filter @specter/inventory-reference test:e2e
pnpm --filter @specter/inventory-reference dev
```

Checklist: clean state, UI path works, commands accurate, tests stable, demo reset possible.

### Task 20: Complete Nexus tasks

Move all completed second-video task notes to `completions/`, refresh `Task points dashboard.md` and `Triage dashboard.md`, verify counts.

---

## Overall gate

```bash
cd /home/lucifer/work/active/specter
git status --short
pnpm install --frozen-lockfile
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm release:verify
pnpm release:dry-run
pnpm --filter @specter/inventory-reference test:e2e
```

Expected: all pass; only intentional repo changes are present; starter smoke passes from clean temp; published smoke passes after publish; inventory demo can be recorded without code changes.

## Execution strategy

1. Main agent unblocks WSL Node/pnpm.
2. Subagent A fixes booking lifecycle.
3. Subagent B writes docs/template workflow.
4. Subagent C scaffolds inventory app events/commands/queries.
5. Main/senior review agent integrates and runs root checks.
6. Dedicated subagent adds UI/e2e once backend slices are stable.
7. Main agent handles publish dry-run/real publish because credentials and approval are required.
