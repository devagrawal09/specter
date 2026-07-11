import { testSliceImplementations } from "@specter-ts/core/testing";

import { sqliteScenario } from "../../db/scenario-tests";
import { chatEventDefinitions, chatRegistrations } from "./registry";

testSliceImplementations(chatRegistrations, {
  events: chatEventDefinitions,
  runScenario: sqliteScenario,
});
