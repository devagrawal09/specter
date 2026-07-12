import workspacesQuerySpec from "./spec";
import type { Event } from "@specter-ts/core";
import { z } from "zod";

import { createSqliteSliceStore } from "../../../db/specter-sqlite";
import { workspaceCreatedEvent } from "../events";

type Workspace = {
  id: string;
  name: string;
};

type WorkspacesState = {
  workspaces: Workspace[];
};

const workspacesQuery = workspacesQuerySpec
  .inputSchema(z.object({}))
  .outputSchema<Workspace[]>()
  .store(createSqliteSliceStore<WorkspacesState>(() => ({ workspaces: [] })))
  .apply(
    workspaceCreatedEvent,
    async (
      event: Event<typeof workspaceCreatedEvent.type, unknown>,
      state: WorkspacesState,
    ) => {
      const payload = event.payload as Awaited<
        ReturnType<typeof workspaceCreatedEvent.decode>
      >;

      if (
        state.workspaces.some(
          (workspace) => workspace.id === payload.workspaceId,
        )
      ) {
        return;
      }

      state.workspaces.push({
        id: payload.workspaceId,
        name: payload.name,
      });
    },
  )
  .handle(async (_query, state) => state.workspaces);

export default workspacesQuery;
