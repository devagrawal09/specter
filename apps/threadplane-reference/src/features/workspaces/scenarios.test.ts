import { testSliceImplementations } from "@specter-ts/core/testing";

import { sqliteScenario } from "../../db/scenario-tests";
import { workspaceEventDefinitions, workspaceRegistrations } from "./registry";

testSliceImplementations(workspaceRegistrations, {
  events: workspaceEventDefinitions,
  runScenario: sqliteScenario,
});
