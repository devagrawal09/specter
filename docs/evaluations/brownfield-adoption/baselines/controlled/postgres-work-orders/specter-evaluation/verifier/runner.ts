import { createEvaluationDriver } from './driver';

export async function runEvaluation(): Promise<void> {
  // TODO(coordinator): compare driver observations with the immutable JSON contracts after assignment acceptance.
  const driver = createEvaluationDriver();
  await driver.close();
  throw new Error('TODO(coordinator): PostgreSQL work-order verifier runner is not implemented');
}
