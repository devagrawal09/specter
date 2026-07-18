import type {
  AttemptPhase,
  CoordinatorObservation,
  EvidenceComparison,
  EvidenceObservation,
  GreenfieldDriverFactory,
  JsonValue,
  ProjectSemanticMap,
  SemanticCapability,
  SemanticMapping,
  VerificationPlan,
} from '@specter-ts/greenfield-verifier'

/**
 * Coordinator-only template. The project semantic map is parsed from JSON data;
 * adopter code is never imported into this process as an executable verifier
 * adapter. Concrete inputs, schedules, faults, and oracles remain private.
 */

export interface CoordinatorObservationRequest {
  attempt: VerificationPlan['attempt']
  phase: AttemptPhase
  semanticId: string
  capability: SemanticCapability
  mapping?: SemanticMapping
  input?: JsonValue
  signal: AbortSignal
}

export interface CoordinatorObservationServices {
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

  /**
   * Drive mapped Commands/Queries through generated HTTP, subscriptions through
   * public SSE, browser mappings through the pinned browser, and Event mappings
   * by independently reading durable Event rows. The returned artifact must
   * contain the unnormalized captures used to compute `normalized` and parity.
   */
  observeMapped(
    request: CoordinatorObservationRequest & { mapping: SemanticMapping },
  ): Promise<CoordinatorObservation>

  /**
   * Coordinator-owned process/restart/replay/fault/outbox/Reaction observation.
   * These capabilities have no adopter mapping and must use frozen service code.
   */
  observeOperational(
    request: CoordinatorObservationRequest & { mapping?: undefined },
  ): Promise<CoordinatorObservation>
}

export interface PrivateCaseContext {
  attempt: VerificationPlan['attempt']
  phase: AttemptPhase
  signal: AbortSignal
  observe(
    semanticId: string,
    capability: SemanticCapability,
    input?: JsonValue,
  ): Promise<CoordinatorObservation>
}

export interface PrivateCaseObservation {
  evidence: EvidenceObservation
  /** Every scored fact must identify the coordinator-captured raw observation. */
  observations: readonly CoordinatorObservation[]
}

export type PrivateCheckCase = (
  context: PrivateCaseContext,
) => Promise<PrivateCaseObservation>

export function createCoordinatorDriver(options: {
  semanticMap: ProjectSemanticMap
  cases: Readonly<Record<string, PrivateCheckCase>>
  services: CoordinatorObservationServices
}): GreenfieldDriverFactory {
  return (plan) => ({
    async setup({ phase, signal }) {
      await options.services.start({ attempt: plan.attempt, phase, signal })
    },

    async runCheck({ check, phase, signal }) {
      const run = options.cases[check.id]
      if (run === undefined) {
        throw new Error(`No private coordinator case for check ${check.id}`)
      }
      const captured: CoordinatorObservation[] = []
      const result = await run({
        attempt: plan.attempt,
        phase,
        signal,
        async observe(semanticId, capability, input) {
          const mapping = options.semanticMap.mappings[semanticId]
          if (mapping !== undefined && mapping.capability !== capability) {
            throw new Error(
              `Semantic capability mismatch for ${semanticId}: mapped ${mapping.capability}, requested ${capability}`,
            )
          }
          const observation =
            mapping === undefined
              ? await options.services.observeOperational({
                  attempt: plan.attempt,
                  phase,
                  semanticId,
                  capability,
                  input,
                  signal,
                })
              : await options.services.observeMapped({
                  attempt: plan.attempt,
                  phase,
                  semanticId,
                  capability,
                  mapping,
                  input,
                  signal,
                })
          assertRawObservation(observation, semanticId, capability)
          captured.push(observation)
          return observation
        },
      })

      if (result.observations.length === 0) {
        throw new Error(`Check ${check.id} returned no raw coordinator observation`)
      }
      if (
        result.observations.some(
          (observation) => !captured.includes(observation),
        )
      ) {
        throw new Error(
          `Check ${check.id} returned an observation not captured by coordinator services`,
        )
      }
      const parity = result.observations.flatMap(
        (observation) => observation.parity,
      )
      if (parity.length === 0) {
        throw new Error(`Check ${check.id} returned no independent parity comparison`)
      }
      return {
        ...result.evidence,
        comparisons: [...(result.evidence.comparisons ?? []), ...parity],
        artifacts: [
          ...(result.evidence.artifacts ?? []),
          ...result.observations.flatMap((observation) => observation.artifacts),
        ],
      }
    },

    async teardown({ phase, signal }) {
      await options.services.stop({ attempt: plan.attempt, phase, signal })
    },
  })
}

function assertRawObservation(
  observation: CoordinatorObservation,
  semanticId: string,
  capability: SemanticCapability,
): void {
  if (
    observation.semanticId !== semanticId ||
    observation.capability !== capability
  ) {
    throw new Error(`Coordinator observation identity mismatch for ${semanticId}`)
  }
  if (Object.keys(observation.channels).length === 0) {
    throw new Error(`Coordinator observation ${semanticId} has no raw channels`)
  }
  if (observation.artifacts.length === 0) {
    throw new Error(`Coordinator observation ${semanticId} has no raw artifact`)
  }
}

export function exactComparison(
  label: string,
  expected: JsonValue,
  actual: JsonValue,
): EvidenceComparison {
  return { label, expected, actual }
}

/**
 * Example only. The service—not adopter code—executes the public Command and
 * reads the durable Event Log. Its parity compares normalized HTTP receipt data
 * with independently captured durable facts.
 */
export const examplePrivateCase: PrivateCheckCase = async ({
  observe,
  phase,
}) => {
  const observation = await observe(
    'ed-operations.command.assign-treatment-bed',
    'command',
    { request: '<coordinator-owned-deterministic-input>' },
  )
  return {
    evidence: {
      claims: {
        commandAccepted: true,
        eventsCommitted: true,
        durableEventsExact: true,
      },
      comparisons: [
        exactComparison(
          '<coordinator-owned-exact-public-oracle>',
          { receipt: '<expected>' },
          observation.normalized,
        ),
      ],
      details: { phase },
    },
    observations: [observation],
  }
}
