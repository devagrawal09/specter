export interface EvaluationObservation {
  readonly response: unknown;
  readonly persistedState: unknown;
  readonly durableEffects: unknown;
}

export interface EvaluationDriver {
  resetLegacySnapshot(): Promise<void>;
  readLegacySnapshot(): Promise<unknown>;
  executeSelectedOperation(): Promise<EvaluationObservation>;
  readLegacyCompatibilitySurface(): Promise<unknown>;
  close(): Promise<void>;
}

export function createEvaluationDriver(): EvaluationDriver {
  // TODO(coordinator): bind this contract to the accepted assignment and its isolated runtime.
  throw new Error('TODO(coordinator): PostgreSQL work-order verifier driver is not configured');
}
