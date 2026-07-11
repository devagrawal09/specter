import { createEventDefinition } from "@specter-ts/core";
import { z } from "zod";

export const messagePostedEvent = createEventDefinition(
  "message-posted",
  z.object({
    messageId: z.string(),
    workspaceId: z.string(),
    author: z.object({
      type: z.enum(["user", "agent"]),
      displayName: z.string(),
      agentId: z.string().optional(),
    }),
    content: z.string(),
    parentMessageId: z.string().optional(),
  }),
);

export const chatEventDefinitions = [messagePostedEvent] as const;
