import { createQuerySlice, event } from "@specter-ts/core/spec";

const workspaceAgentRunsSpec = createQuerySlice("workspaceAgentRuns")
  .description("Lists Agent Runs for a workspace with their latest status.")
  .scenarios({
    description:
      "Lists workspace Agent Runs with pending, running, completed, and failed statuses.",
    given: [
      event("agent-run-requested", {
        runId: "run-1",
        workspaceId: "workspace-1",
        postId: "post-1",
        agentId: "specter",
        agentName: "Specter",
        requestedBy: { type: "user", userId: "user-1", displayName: "Ada" },
      }),
      event("agent-run-started", {
        runId: "run-1",
        workspaceId: "workspace-1",
        agentId: "specter",
      }),
      event("agent-run-completed", {
        runId: "run-1",
        workspaceId: "workspace-1",
        agentId: "specter",
      }),
      event("agent-run-requested", {
        runId: "run-2",
        workspaceId: "workspace-1",
        agentId: "specter",
        agentName: "Specter",
        requestedBy: { type: "system" },
      }),
      event("agent-run-requested", {
        runId: "run-3",
        workspaceId: "workspace-1",
        agentId: "specter",
        agentName: "Specter",
        requestedBy: { type: "system" },
      }),
      event("agent-run-started", {
        runId: "run-3",
        workspaceId: "workspace-1",
        agentId: "specter",
      }),
      event("agent-run-requested", {
        runId: "run-4",
        workspaceId: "workspace-1",
        agentId: "specter",
        agentName: "Specter",
        requestedBy: { type: "system" },
      }),
      event("agent-run-failed", {
        runId: "run-4",
        workspaceId: "workspace-1",
        agentId: "specter",
        error: "Agent runtime unavailable",
      }),
      event("agent-run-requested", {
        runId: "run-5",
        workspaceId: "workspace-2",
        agentId: "specter",
        agentName: "Specter",
        requestedBy: { type: "system" },
      }),
    ],
    when: { workspaceId: "workspace-1" },
    expect: [
      {
        runId: "run-1",
        workspaceId: "workspace-1",
        postId: "post-1",
        agentId: "specter",
        agentName: "Specter",
        status: "completed",
        requestedBy: { type: "user", userId: "user-1", displayName: "Ada" },
      },
      {
        runId: "run-2",
        workspaceId: "workspace-1",
        agentId: "specter",
        agentName: "Specter",
        status: "pending",
        requestedBy: { type: "system" },
      },
      {
        runId: "run-3",
        workspaceId: "workspace-1",
        agentId: "specter",
        agentName: "Specter",
        status: "running",
        requestedBy: { type: "system" },
      },
      {
        runId: "run-4",
        workspaceId: "workspace-1",
        agentId: "specter",
        agentName: "Specter",
        status: "failed",
        requestedBy: { type: "system" },
        error: "Agent runtime unavailable",
      },
    ],
  });

export default workspaceAgentRunsSpec;
