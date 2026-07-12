import createWorkspaceSpec from "./spec";
import { z } from "zod";

import { createMemorySliceStore } from "../../../testing/memory-slice-store";
import {
  workspaceCreatedEvent,
  workspaceFilesystemInitializedEvent,
  workspaceFilesystemScanRequestedEvent,
} from "../events";

const createWorkspace = createWorkspaceSpec
  .inputSchema(
    z.object({
      workspaceId: z.string(),
      scanId: z.string(),
      name: z.string(),
      createdBy: z
        .object({
          userId: z.string().optional(),
          displayName: z.string(),
        })
        .optional(),
    }),
  )
  .store(createMemorySliceStore(() => ({})))
  .handle(async (command) => {
    const name = command.name.trim();
    const workspaceId = command.workspaceId;

    if (!name) {
      throw new Error("Workspace name is required");
    }

    return [
      workspaceCreatedEvent.create({
        workspaceId,
        name,
        createdBy: command.createdBy,
      }),
      workspaceFilesystemInitializedEvent.create({
        workspaceId,
      }),
      workspaceFilesystemScanRequestedEvent.create({
        scanId: command.scanId,
        workspaceId,
        reason: "workspaceCreated",
        requestedBy: { type: "system" },
      }),
    ];
  });

export default createWorkspace;
