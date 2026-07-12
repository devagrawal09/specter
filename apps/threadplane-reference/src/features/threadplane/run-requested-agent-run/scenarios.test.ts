import { testSliceImplementations } from "@specter-ts/core/testing";

import { sqliteScenario } from "../../../db/scenario-tests";
import runRequestedAgentRun from "./impl";
import {
  agentRunCompletedEvent,
  agentRunFailedEvent,
  agentRunRequestedEvent,
  agentRunStartedEvent,
  agentRunStreamedEvent,
  toolCallCompletedEvent,
  toolCallFailedEvent,
  toolCallStartedEvent,
} from "../events";

testSliceImplementations([runRequestedAgentRun], {
  events: [
    agentRunRequestedEvent,
    agentRunStartedEvent,
    agentRunStreamedEvent,
    agentRunCompletedEvent,
    agentRunFailedEvent,
    toolCallStartedEvent,
    toolCallCompletedEvent,
    toolCallFailedEvent,
  ],
  runScenario: sqliteScenario,
});
