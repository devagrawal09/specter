# Brownfield Verifier

This private package is the frozen, visible adapter contract verifier for the
Specter brownfield adoption evaluation. It is executable documentation, not a
published production adapter.

Each assigned application supplies an `AdapterHarnessDriver` backed by its real
database and durable scheduler. The verifier owns the cases, fixed Event data,
and the Command/Reaction probe. The driver owns only application lifecycle,
normalized probe-state capabilities, and scheduler inspection operations that
are absent from Specter's public adapter interfaces.

The runner returns a versioned JSON report. Scored agents may run it throughout
their attempt; the coordinator runs the same package independently after the
repository is frozen.

The runner owns case isolation. It makes bounded `driver.reset()` calls before
and after every case. A failed pre-reset skips the case body but never the
post-reset attempt. Body, close, and post-reset failures are retained together
in the failed report entry. Cases must not depend on report order. The driver's
`deliveries()` result may use any outer ordering; each delivery's `attemptIds`
must be chronological. `retryDeadLetter(deliveryId)` resumes that same delivery:
`deliveryId` and `scheduledAt` stay stable, while `attemptCount` and `attemptIds`
remain cumulative across the manual retry.

The case body and each pre/post reset phase have separate five-second timeouts,
but `Promise.race` cannot cancel an arbitrary adapter promise. Any timeout is
therefore terminal for the suite: the timed-out case fails, the runner attempts
one bounded best-effort post-reset, and all later cases are reported as
`not-run` without entering their bodies. The report still contains all 16 case
IDs in deterministic order. A timed-out operation may remain live and may
mutate state after reset, so the verifier must run in a disposable process. The
supplied runner flushes its JSON report and explicitly exits to terminate any
outstanding handles. Assignments with slower real infrastructure may set an
explicit positive limit:

```ts
await runAdapterContractSuite(adapterHarnessDriver, {
  caseTimeoutMs: 15_000,
})
```

The concurrent-decision case holds one transaction open for 40% of that limit
and checks that a second callback cannot enter or decide from stale state during
that bounded interval. This is strong observable evidence of serialization,
not a mathematical proof against an arbitrarily delayed unlocked callback.
