# Add a Worklog garden simulation

## Goal

Turn the same permanent point-earning activity already recorded by Worklog into
a calm, living garden that makes accumulated work visible without creating a
second source of truth.

## Scope

- In: an event-derived garden query, a subscribed Garden tab, topic plots and a
  meadow, accessible plant inspection, permanent milestone growth, dormant
  archived elements, manual visual moods, and lightweight growth notices.
- Out: new score rules, new domain events or commands, durable simulation state,
  upkeep, resources, timers, decay, seasons, manual arranging, and garden-based
  editing or navigation.

## Required behavior

- Journal, task, topic, and connection creation appear as flowers, crops, trees,
  and vines after their existing creation point awards.
- First task completion ripens its crop, a completed-task connection flowers its
  vine, and an all-tasks-completed topic fruits its tree. Earned stages remain
  after reopening or later relationship changes.
- The complete garden is rebuilt from existing Events. Archived records and
  connections remain visible but dormant, and restoring them revives their
  presentation.
- Topic trees anchor stable, scrollable plots. A record connected to several
  topics appears once with vines to every related topic; records without a
  topic appear in a meadow.
- Garden elements are keyboard-accessible and reveal labels and details on
  focus or selection. Day, Sunset, and Night moods are presentation-only and
  remembered in the browser.
- Live garden changes produce one brief, accessible summary notice outside the
  Garden tab. Initial history loading produces no notice.

## Tasks

- [ ] Add and register the scenario-tested, event-derived garden query.
- [ ] Add deterministic garden layout helpers, the Garden tab, plant and vine
  rendering, inspection, moods, motion preferences, and growth notices.
- [ ] Add focused helper, runtime, and browser coverage using temporary data.
- [ ] Run the Worklog checks and the repository validation baseline.
- [ ] Update the Worklog README with lasting garden behavior and boundaries.
- [ ] Delete this OpenSpec change directory before merge.

## Validation

- `pnpm --filter @specter/worklog check`
- `pnpm --filter @specter/worklog lint`
- `pnpm --filter @specter/worklog typecheck`
- `pnpm --filter @specter/worklog test`
- `pnpm --filter @specter/worklog test:e2e`
- `pnpm --filter @specter/worklog build`
- `pnpm check && pnpm lint && pnpm typecheck && pnpm test && pnpm build`
- `node scripts/validate-openspec.mjs`
