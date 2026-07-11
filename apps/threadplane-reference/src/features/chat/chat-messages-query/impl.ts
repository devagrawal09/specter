import chatMessagesQuerySpec from "./spec";
import type { Event } from "@specter-ts/core";
import { z } from "zod";

import { createSqliteSliceStore } from "../../../db/specter-sqlite";
import { messagePostedEvent } from "../events";

type ChatMessage = {
  id: string;
  workspaceId: string;
  author: {
    type: "user" | "agent";
    displayName: string;
    agentId?: string;
  };
  content: string;
  parentMessageId?: string;
};

type ChatMessagesState = {
  messages: ChatMessage[];
};

const chatMessagesQuery = chatMessagesQuerySpec
  .inputSchema(
    z.object({
      workspaceId: z.string(),
    }),
  )
  .outputSchema<ChatMessage[]>()
  .store(createSqliteSliceStore<ChatMessagesState>(() => ({ messages: [] })))
  .apply(
    messagePostedEvent,
    async (
      event: Event<typeof messagePostedEvent.type, unknown>,
      state: ChatMessagesState,
    ) => {
      const payload = event.payload as Awaited<
        ReturnType<typeof messagePostedEvent.decode>
      >;

      state.messages.push({
        id: payload.messageId,
        workspaceId: payload.workspaceId,
        author: payload.author,
        content: payload.content,
        parentMessageId: payload.parentMessageId,
      });
    },
  )
  .handle(async (query, state) =>
    state.messages.filter(
      (message) => message.workspaceId === query.workspaceId,
    ),
  );

export default chatMessagesQuery;
