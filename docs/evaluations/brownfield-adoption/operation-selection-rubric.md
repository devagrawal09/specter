# Brownfield Migration-Target Rubric

The coordinator selects one operation before any adopter sees an application.
Every selected operation must satisfy every required gate; scoring is used only
to choose between multiple eligible operations.

## Required gates

- The operation is reachable through an existing public HTTP, RPC, or GraphQL
  contract with runtime input validation.
- Its decision depends on persisted domain state and rejects at least one
  meaningful state transition.
- The repository already contains legacy records that exercise both an accepted
  and a rejected transition.
- At least one unchanged legacy reader observes the state that the operation
  changes.
- The write path can move behind one Specter Command without migrating every
  reader or redesigning authentication.
- The public success and error contracts are covered by executable tests.
- The operation does not require an unavailable external SaaS credential.

## Tie-break score

Score each eligible operation from zero to two on each dimension:

1. State-machine clarity: the guard and accepted transition are locally
   inspectable.
2. Compatibility evidence: multiple unchanged readers exercise the same state.
3. Existing coverage: validation, success, and rejection already have tests.
4. Bootstrap quality: a small legacy snapshot represents meaningful current
   state without reconstructing unavailable history.
5. Background-work relevance: the operation naturally interacts with the
   application's durable scheduler, or the scheduler remains independently
   testable through the fixed verifier probe.
6. Scope containment: authentication and unrelated workflows can remain intact.

Choose the highest-scoring eligible operation. Resolve ties by the lexical order
of the operation's public route or RPC name. Publish the completed rubric before
starting scored work.
