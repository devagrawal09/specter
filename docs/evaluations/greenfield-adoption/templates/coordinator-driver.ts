import type {
  AttemptPhase,
  EvidenceComparison,
  EvidenceObservation,
  GreenfieldDriverFactory,
  JsonValue,
  ProjectSemanticAdapter,
  SemanticCapability,
  SemanticProbeResult,
  VerificationPlan,
} from '@specter-ts/greenfield-verifier'

/**
 * Coordinator-only template. Keep this file, the check catalog, all concrete
 * inputs/schedules/faults, and every expected value outside the adopter kit.
 */

export interface PrivateCaseContext {
  attempt: VerificationPlan['attempt']
  phase: AttemptPhase
  signal: AbortSignal
  probe(
    semanticId: string,
    capability: SemanticCapability,
    input?: JsonValue,
  ): Promise<SemanticProbeResult>
}

export type PrivateCheckCase = (
  context: PrivateCaseContext,
) => Promise<EvidenceObservation>

export interface CoordinatorServices {
  start(context: {
    attempt: VerificationPlan['attempt']
    phase: AttemptPhase
    signal: AbortSignal
  }): Promise<void>
  stop(context: {
    attempt: VerificationPlan['attempt']
    phase: AttemptPhase
    signal: AbortSignal
  }): Promise<void>
}

export function createCoordinatorDriver(options: {
  adapter: ProjectSemanticAdapter
  cases: Readonly<Record<string, PrivateCheckCase>>
  services: CoordinatorServices
}): GreenfieldDriverFactory {
  return (plan) => ({
    async setup({ phase, signal }) {
      await options.services.start({ attempt: plan.attempt, phase, signal })
      await options.adapter.setup?.({ attempt: plan.attempt, phase, signal })
    },

    async runCheck({ check, phase, signal }) {
      const run = options.cases[check.id]
      if (run === undefined) {
        throw new Error(`No private coordinator case for check ${check.id}`)
      }
      return run({
        attempt: plan.attempt,
        phase,
        signal,
        probe(semanticId, capability, input) {
          // Only brief semantics cross the frozen app boundary. In particular,
          // check.id and coordinator-owned expected values never do.
          return options.adapter.probe({
            semanticId,
            capability,
            input,
            phase,
            signal,
          })
        },
      })
    },

    async teardown({ phase, signal }) {
      try {
        await options.adapter.teardown?.({ attempt: plan.attempt, phase, signal })
      } finally {
        await options.services.stop({ attempt: plan.attempt, phase, signal })
      }
    },
  })
}

/** Coordinator-owned helper demonstrating where an exact oracle belongs. */
export function exactComparison(
  label: string,
  expected: JsonValue,
  actual: JsonValue,
): EvidenceComparison {
  return { label, expected, actual }
}

/**
 * Deterministic example case. Replace all placeholder values in the private
 * coordinator kit before freezing it; do not move them into the app adapter.
 */
export const examplePrivateCase: PrivateCheckCase = async ({
  phase,
  signal,
  probe,
}) => {
  const observed = await probe(
    'ed-operations.command.assign-treatment-bed',
    'command',
    { request: '<coordinator-owned-deterministic-input>' },
  )
  return {
    claims: {
      commandAccepted: true,
      eventsCommitted: true,
      durableEventsExact: true,
    },
    comparisons: [
      exactComparison(
        '<coordinator-owned-comparison-label>',
        { receipt: '<coordinator-owned-expected-value>' },
        observed.value,
      ),
    ],
    details: { phase },
    artifacts: observed.artifacts,
  }
}
