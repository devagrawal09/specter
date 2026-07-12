import recordToolCallCompletedSpec from "./spec";
import { z } from "zod";

import { createMemorySliceStore } from "../../../testing/memory-slice-store";
import { toolCallCompletedEvent, toolCallStartedEvent } from "../events";

const recordToolCallCompleted = recordToolCallCompletedSpec
  .inputSchema(
    z.object({
      toolCallId: z.string(),
      runId: z.string(),
      workspaceId: z.string(),
      agentId: z.string(),
      toolName: z.string(),
      outputSummary: z.string().optional(),
    }),
  )
  .store(createMemorySliceStore(() => ({})))
  .apply(toolCallStartedEvent, async () => {})
  .handle(async (command) => {
    return [
      toolCallCompletedEvent.create({
        toolCallId: command.toolCallId,
        runId: command.runId,
        workspaceId: command.workspaceId,
        agentId: command.agentId,
        toolName: command.toolName,
        outputSummary: command.outputSummary,
      }),
    ];
  });

export default recordToolCallCompleted;
