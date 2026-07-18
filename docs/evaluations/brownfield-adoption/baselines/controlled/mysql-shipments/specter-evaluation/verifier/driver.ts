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
  // TODO(coordinator): bind this contract to the accepted assignment and its isolated MySQL/Redis runtime.
  throw new Error("TODO(coordinator): MySQL shipments verifier driver is not configured");
}
