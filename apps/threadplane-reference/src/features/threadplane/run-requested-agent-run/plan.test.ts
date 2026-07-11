import { describe, expect, it } from "vitest";

import {
  createRunRequestedAgentRunState,
  nextRunRequestedAgentRunCommand,
} from "./impl";

describe("nextRunRequestedAgentRunCommand", () => {
  it("starts a requested run before tool work", () => {
    const state = createRunRequestedAgentRunState();
    state.requestedRuns.push({
      runId: "run-1",
      workspaceId: "workspace-1",
      postId: "post-1",
      agentId: "specter",
      agentName: "Specter",
    });
    state.runPlans["run-1"] = {
      toolName: "searchFiles",
      chunks: ["I found ", "the issue."],
      shouldFail: false,
      failed: false,
      completed: false,
      toolStarted: false,
      toolCompleted: false,
      streamIndex: 0,
    };

    expect(nextRunRequestedAgentRunCommand(state)).toEqual({
      type: "recordAgentRunStarted",
      payload: {
        runId: "run-1",
        workspaceId: "workspace-1",
        agentId: "specter",
      },
    });
  });

  it("emits tool lifecycle and failure branches deterministically", () => {
    const state = createRunRequestedAgentRunState();
    state.requestedRuns.push({
      runId: "run-fail",
      workspaceId: "workspace-1",
      postId: "post-1",
      agentId: "specter",
      agentName: "Specter",
    });
    state.runPlans["run-fail"] = {
      toolName: "searchFiles",
      chunks: ["I found ", "the issue."],
      shouldFail: true,
      failed: false,
      completed: false,
      toolStarted: true,
      toolCompleted: false,
      streamIndex: 0,
    };
    state.startedRunIds.add("run-fail");

    expect(nextRunRequestedAgentRunCommand(state)).toEqual({
      type: "recordToolCallFailed",
      payload: {
        toolCallId: "run-fail-tool-1",
        runId: "run-fail",
        workspaceId: "workspace-1",
        agentId: "specter",
        toolName: "searchFiles",
        error: "Simulated Agent failed while running searchFiles.",
      },
    });
  });

  it("streams and completes once tools are done", () => {
    const state = createRunRequestedAgentRunState();
    state.requestedRuns.push({
      runId: "run-2",
      workspaceId: "workspace-1",
      agentId: "specter",
      agentName: "Specter",
    });
    state.runPlans["run-2"] = {
      toolName: "searchFiles",
      chunks: ["I found ", "the issue."],
      shouldFail: false,
      failed: false,
      completed: false,
      toolStarted: true,
      toolCompleted: true,
      streamIndex: 0,
    };
    state.startedRunIds.add("run-2");

    expect(nextRunRequestedAgentRunCommand(state)).toEqual({
      type: "recordAgentRunStreamed",
      payload: {
        chunkId: "run-2-chunk-1",
        runId: "run-2",
        workspaceId: "workspace-1",
        agentId: "specter",
        sequence: 0,
        delta: "I found ",
      },
    });

    state.runPlans["run-2"].streamIndex = 2;

    expect(nextRunRequestedAgentRunCommand(state)).toEqual({
      type: "recordAgentRunCompleted",
      payload: {
        runId: "run-2",
        workspaceId: "workspace-1",
        agentId: "specter",
      },
    });
  });
});
