import { createEvaluationDriver } from "./driver.js";

export async function runEvaluation(): Promise<void> {
  // TODO(coordinator): compare driver observations with the immutable JSON contracts after assignment acceptance.
  const driver = createEvaluationDriver();
  await driver.close();
  throw new Error("TODO(coordinator): MySQL shipments verifier runner is not implemented");
}
