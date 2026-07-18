/**
 * Public, self-contained, data-only semantic map. The adopter fills in names
 * selected by the project; no function in this file can execute a verifier
 * check, inspect persistence, restart a process, inject a fault, or decide pass.
 */
export type JsonPointer = `/${string}`

export interface ResultNormalization {
  readonly kind: 'identity' | 'objectFields'
  /** Canonical output field to raw public-value JSON Pointer. */
  readonly fields?: Readonly<Record<string, JsonPointer>>
}

export interface ObjectFieldMapping {
  /** App payload JSON Pointer to coordinator-input JSON Pointer. */
  readonly fields: Readonly<Record<JsonPointer, JsonPointer>>
}

export interface EnvelopeSemanticMapping {
  readonly capability: 'command' | 'query'
  readonly envelopeType: string
  readonly request:
    | { readonly kind: 'identity' }
    | ({ readonly kind: 'objectFields' } & ObjectFieldMapping)
  readonly result: ResultNormalization
}

export interface SubscriptionSemanticMapping {
  readonly capability: 'subscription'
  readonly queryEnvelopeType: string
  readonly request:
    | { readonly kind: 'identity' }
    | ({ readonly kind: 'objectFields' } & ObjectFieldMapping)
  readonly result: ResultNormalization
}

export interface EventFactMapping {
  readonly eventType: string
  readonly canonicalType: string
  readonly payload: ResultNormalization
}

export interface EventLogSemanticMapping {
  readonly capability: 'eventLog'
  readonly events: readonly EventFactMapping[]
}

export interface BrowserSemanticMapping {
  readonly capability: 'browser'
  readonly route: string
  /** Brief action/value name to stable accessible selector or test ID. */
  readonly selectors: Readonly<Record<string, string>>
}

export type SemanticMapping =
  | BrowserSemanticMapping
  | EnvelopeSemanticMapping
  | EventLogSemanticMapping
  | SubscriptionSemanticMapping

export interface ProjectSemanticMap {
  readonly schemaVersion: 1
  readonly domain: string
  readonly mappings: Readonly<Record<string, SemanticMapping>>
}

/**
 * The adopter writes `specter-evaluation/semantic-map.json` conforming to these
 * types and the supplied JSON Schema. This TypeScript file contains no project
 * value to import or execute. Coordinator code reads the JSON as data.
 *
 * Only command, query, subscription, eventLog, and browser catalog entries are
 * mapped. Coordinator-owned services implement process control, restart,
 * replay, fault injection, Reaction-delivery, and outbox observation.
 */
