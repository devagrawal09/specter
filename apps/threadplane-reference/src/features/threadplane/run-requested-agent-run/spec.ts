import { createReactionSlice, event } from "@specter-ts/core/spec";

const runRequestedAgentRunSpec = createReactionSlice("runRequestedAgentRun")
  .description(
    "Executes requested Agent Runs through the configured agent plugin.",
  )
  .scenarios(
    {
      description: "Queues a requested Agent Run that has not started.",
      given: [
        event("agent-run-requested", {
          runId: "run-1",
          workspaceId: "workspace-1",
          postId: "post-1",
          agentId: "specter",
          agentName: "Specter",
          requestedBy: { type: "user", displayName: "Ada" },
        }),
      ],
      expect: [
        {
          type: "recordAgentRunStarted",
          payload: {
            runId: "run-1",
            workspaceId: "workspace-1",
            agentId: "specter",
          },
        },
      ],
    },
    {
      description: "Continues an Agent Run that already started.",
      given: [
        event("agent-run-requested", {
          runId: "run-1",
          workspaceId: "workspace-1",
          agentId: "specter",
          agentName: "Specter",
          requestedBy: { type: "system" },
        }),
        event("agent-run-started", {
          runId: "run-1",
          workspaceId: "workspace-1",
          agentId: "specter",
        }),
      ],
      expect: [
        {
          type: "recordToolCallStarted",
          payload: {
            toolCallId: "run-1-tool-1",
            runId: "run-1",
            workspaceId: "workspace-1",
            agentId: "specter",
            toolName: "searchFiles",
            inputSummary: "Simulated workspace inspection",
          },
        },
      ],
    },
    {
      description:
        "Does not queue an Agent Run that already reached a terminal state.",
      given: [
        event("agent-run-requested", {
          runId: "run-1",
          workspaceId: "workspace-1",
          agentId: "specter",
          agentName: "Specter",
          requestedBy: { type: "system" },
        }),
        event("agent-run-failed", {
          runId: "run-1",
          workspaceId: "workspace-1",
          agentId: "specter",
          error: "Agent runtime unavailable",
        }),
        event("tool-call-started", {
          toolCallId: "run-1-tool-1",
          runId: "run-1",
          workspaceId: "workspace-1",
          agentId: "specter",
          toolName: "searchFiles",
        }),
        event("tool-call-failed", {
          toolCallId: "run-1-tool-1",
          runId: "run-1",
          workspaceId: "workspace-1",
          agentId: "specter",
          toolName: "searchFiles",
          error: "Search unavailable",
        }),
        event("agent-run-requested", {
          runId: "run-2",
          workspaceId: "workspace-1",
          agentId: "specter",
          agentName: "Specter",
          requestedBy: { type: "system" },
        }),
        event("agent-run-completed", {
          runId: "run-2",
          workspaceId: "workspace-1",
          agentId: "specter",
        }),
        event("tool-call-completed", {
          toolCallId: "run-2-tool-1",
          runId: "run-2",
          workspaceId: "workspace-1",
          agentId: "specter",
          toolName: "searchFiles",
        }),
        event("agent-run-streamed", {
          runId: "run-2",
          workspaceId: "workspace-1",
          agentId: "specter",
          chunkId: "run-2-chunk-1",
          sequence: 0,
          delta: "Done.",
        }),
      ],
      expect: [],
    },
  );

export default runRequestedAgentRunSpec;
