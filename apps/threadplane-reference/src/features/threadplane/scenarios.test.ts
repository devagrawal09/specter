import { testSliceImplementations } from "@specter-ts/core/testing";

import { sqliteScenario } from "../../db/scenario-tests";
import agentRunTimeline from "./agent-run-timeline/impl";
import recordAgentRunCompleted from "./record-agent-run-completed/impl";
import recordAgentRunFailed from "./record-agent-run-failed/impl";
import recordAgentRunStarted from "./record-agent-run-started/impl";
import recordAgentRunStreamed from "./record-agent-run-streamed/impl";
import recordToolCallCompleted from "./record-tool-call-completed/impl";
import recordToolCallFailed from "./record-tool-call-failed/impl";
import recordToolCallStarted from "./record-tool-call-started/impl";
import requestAgentRun from "./request-agent-run/impl";
import workspaceAgentRuns from "./workspace-agent-runs/impl";
import {
  agentRunCompletedEvent,
  agentRunFailedEvent,
  agentRunRequestedEvent,
  agentRunStartedEvent,
  agentRunStreamedEvent,
  toolCallCompletedEvent,
  toolCallFailedEvent,
  toolCallStartedEvent,
} from "./events";

const threadplaneAgentRunRegistrations = [
  requestAgentRun,
  recordAgentRunStarted,
  recordAgentRunStreamed,
  recordAgentRunCompleted,
  recordAgentRunFailed,
  recordToolCallStarted,
  recordToolCallCompleted,
  recordToolCallFailed,
  workspaceAgentRuns,
  agentRunTimeline,
] as const;

testSliceImplementations(threadplaneAgentRunRegistrations, {
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
