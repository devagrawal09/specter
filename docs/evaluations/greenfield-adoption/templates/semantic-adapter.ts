/**
 * Public, self-contained adapter contract. Keep it independent from the
 * coordinator-only verifier package so evidence kinds, check IDs, claims, and
 * held-out orchestration never enter the adopter dependency graph.
 */
export type JsonValue =
  | boolean
  | null
  | number
  | string
  | JsonValue[]
  | { [key: string]: JsonValue }

export type AttemptPhase = 'firstAttempt' | 'remediation'

export const semanticCapabilities = [
  'command',
  'query',
  'subscription',
  'eventLog',
  'reactionDelivery',
  'restart',
  'replay',
  'faultInjection',
  'processControl',
  'outbox',
  'browser',
] as const

export type SemanticCapability = (typeof semanticCapabilities)[number]

export interface VisibleAttemptDescriptor {
  id: string
  domain: string
  persistence: 'sqlite' | 'postgres'
  topology: 'singleProcess' | 'multiProcess'
  port: number
  specterVersion: string
  activeLimitMinutes: 180
}

export interface SemanticProbeRequest {
  semanticId: string
  capability: SemanticCapability
  input?: JsonValue
  phase: AttemptPhase
  signal: AbortSignal
}

export interface SemanticProbeResult {
  value: JsonValue
  artifacts?: string[]
}

export interface ProjectSemanticAdapter {
  setup?(context: {
    attempt: Readonly<VisibleAttemptDescriptor>
    phase: AttemptPhase
    signal: AbortSignal
  }): Promise<void>
  probe(request: SemanticProbeRequest): Promise<SemanticProbeResult>
  teardown?(context: {
    attempt: Readonly<VisibleAttemptDescriptor>
    phase: AttemptPhase
    signal: AbortSignal
  }): Promise<void>
}

/**
 * Copy this file into a frozen adopter project and replace exampleRoutes with
 * that project's mappings. Stable semantic IDs come from semantic-catalog.json;
 * local Command, Query, Event, table, and process names remain unconstrained.
 *
 * The adapter is deliberately incapable of receiving verifier check IDs,
 * expected values, claims, visibility, schedules, or pass/fail oracles.
 */

export type SemanticRoute = Readonly<{
  capability: SemanticCapability
  run: (context: {
    input: JsonValue | undefined
    phase: AttemptPhase
    signal: AbortSignal
  }) => Promise<SemanticProbeResult>
}>

export interface AdapterLifecycle {
  setup?(context: {
    attempt: Readonly<VisibleAttemptDescriptor>
    phase: AttemptPhase
    signal: AbortSignal
  }): Promise<void>
  teardown?(context: {
    attempt: Readonly<VisibleAttemptDescriptor>
    phase: AttemptPhase
    signal: AbortSignal
  }): Promise<void>
}

export function createProjectSemanticAdapter(
  routes: Readonly<Record<string, SemanticRoute>>,
  lifecycle: AdapterLifecycle = {},
): ProjectSemanticAdapter {
  return {
    setup: lifecycle.setup,

    async probe(request: SemanticProbeRequest): Promise<SemanticProbeResult> {
      const route = routes[request.semanticId]
      if (route === undefined) {
        throw new Error(`Unsupported semantic ID: ${request.semanticId}`)
      }
      if (route.capability !== request.capability) {
        throw new Error(
          `Semantic capability mismatch for ${request.semanticId}: expected ${route.capability}, received ${request.capability}`,
        )
      }
      return route.run({
        input: request.input,
        phase: request.phase,
        signal: request.signal,
      })
    },

    teardown: lifecycle.teardown,
  }
}

interface ExampleProjectPorts {
  /** Calls an adopter-chosen envelope name through the generated JSON route. */
  command(
    envelope: { type: string; payload: JsonValue },
    options: { signal: AbortSignal },
  ): Promise<JsonValue>
  /** Reads adopter-owned Event rows and normalizes them to brief-owned facts. */
  readCanonicalFacts(options: { signal: AbortSignal }): Promise<JsonValue>
}

/**
 * Illustrative ED mapping only. The internal name `placePatientInCareSpace` is
 * intentionally different from the public semantic ID; adopters choose it.
 * The placeholder payload is not a held-out input or expected value.
 */
export function createExampleEdAdapter(
  ports: ExampleProjectPorts,
): ProjectSemanticAdapter {
  return createProjectSemanticAdapter({
    'ed-operations.command.assign-treatment-bed': {
      capability: 'command',
      async run({ input, signal }) {
        return {
          value: await ports.command(
            {
              type: 'placePatientInCareSpace',
              payload: input ?? { placeholder: 'replace-with-brief-payload' },
            },
            { signal },
          ),
        }
      },
    },
    'ed-operations.event-log.domain-events': {
      capability: 'eventLog',
      async run({ signal }) {
        return { value: await ports.readCanonicalFacts({ signal }) }
      },
    },
  })
}
