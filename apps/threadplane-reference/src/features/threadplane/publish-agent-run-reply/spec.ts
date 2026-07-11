import { createReactionSlice, event } from "@specter-ts/core/spec";

const publishAgentRunReplySpec = createReactionSlice("publishAgentRunReply")
  .description(
    "Requests a visible chat reply when an Agent Run completes with streamed text.",
  )
  .scenarios(
    {
      description:
        "Requests a visible agent reply after a post-targeted Agent Run completes.",
      given: [
        event("agent-run-requested", {
          runId: "run-1",
          workspaceId: "workspace-1",
          postId: "post-1",
          agentId: "specter",
          agentName: "Specter",
          requestedBy: { type: "user", displayName: "Ada" },
        }),
        event("agent-run-streamed", {
          runId: "run-1",
          workspaceId: "workspace-1",
          agentId: "specter",
          chunkId: "chunk-1",
          sequence: 0,
          delta: "I found ",
        }),
        event("agent-run-streamed", {
          runId: "run-1",
          workspaceId: "workspace-1",
          agentId: "specter",
          chunkId: "chunk-2",
          sequence: 1,
          delta: "the issue.",
        }),
        event("agent-run-completed", {
          runId: "run-1",
          workspaceId: "workspace-1",
          agentId: "specter",
        }),
      ],
      expect: [
        {
          type: "recordVisibleAgentReply",
          payload: {
            replyId: "run-1-reply",
            workspaceId: "workspace-1",
            parentPostId: "post-1",
            runId: "run-1",
            agentId: "specter",
            agentName: "Specter",
            content: "I found the issue.",
          },
        },
      ],
    },
    {
      description: "Does not publish a visible reply for a failed Agent Run.",
      given: [
        event("agent-run-requested", {
          runId: "run-1",
          workspaceId: "workspace-1",
          postId: "post-1",
          agentId: "specter",
          agentName: "Specter",
          requestedBy: { type: "user", displayName: "Ada" },
        }),
        event("agent-run-failed", {
          runId: "run-1",
          workspaceId: "workspace-1",
          agentId: "specter",
          error: "Agent runtime unavailable",
        }),
      ],
      expect: [],
    },
    {
      description:
        "Does not publish a visible reply for a run without a post target.",
      given: [
        event("agent-run-requested", {
          runId: "run-1",
          workspaceId: "workspace-1",
          agentId: "specter",
          agentName: "Specter",
          requestedBy: { type: "system" },
        }),
        event("agent-run-completed", {
          runId: "run-1",
          workspaceId: "workspace-1",
          agentId: "specter",
        }),
      ],
      expect: [],
    },
    {
      description:
        "Continues publishing eligible Agent Run replies after an earlier reply event.",
      given: [
        event("agent-run-requested", {
          runId: "run-1",
          workspaceId: "workspace-1",
          postId: "post-1",
          agentId: "specter",
          agentName: "Specter",
          requestedBy: { type: "user", displayName: "Ada" },
        }),
        event("agent-run-streamed", {
          runId: "run-1",
          workspaceId: "workspace-1",
          agentId: "specter",
          chunkId: "chunk-1",
          sequence: 0,
          delta: "Already published.",
        }),
        event("agent-run-completed", {
          runId: "run-1",
          workspaceId: "workspace-1",
          agentId: "specter",
        }),
        event("post-reply-created", {
          replyId: "reply-1",
          workspaceId: "workspace-1",
          parentPostId: "post-1",
          author: { type: "agent", agentId: "specter", displayName: "Specter" },
          content: "Already published.",
          sourceRunId: "run-1",
        }),
        event("agent-run-requested", {
          runId: "run-2",
          workspaceId: "workspace-1",
          postId: "post-2",
          agentId: "specter",
          agentName: "Specter",
          requestedBy: { type: "user", displayName: "Ada" },
        }),
        event("agent-run-streamed", {
          runId: "run-2",
          workspaceId: "workspace-1",
          agentId: "specter",
          chunkId: "chunk-2",
          sequence: 0,
          delta: "Publish this one.",
        }),
        event("agent-run-completed", {
          runId: "run-2",
          workspaceId: "workspace-1",
          agentId: "specter",
        }),
      ],
      expect: [
        {
          type: "recordVisibleAgentReply",
          payload: {
            replyId: "run-2-reply",
            workspaceId: "workspace-1",
            parentPostId: "post-2",
            runId: "run-2",
            agentId: "specter",
            agentName: "Specter",
            content: "Publish this one.",
          },
        },
      ],
    },
  );

export default publishAgentRunReplySpec;
