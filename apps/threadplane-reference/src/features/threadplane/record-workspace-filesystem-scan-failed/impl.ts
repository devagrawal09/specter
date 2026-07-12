import recordWorkspaceFilesystemScanFailedSpec from "./spec";
import { z } from "zod";

import { createMemorySliceStore } from "../../../testing/memory-slice-store";
import { workspaceFilesystemScanFailedEvent } from "../events";

const recordWorkspaceFilesystemScanFailed =
  recordWorkspaceFilesystemScanFailedSpec
    .inputSchema(
      z.object({
        scanId: z.string(),
        workspaceId: z.string(),
        error: z.string(),
      }),
    )
    .store(createMemorySliceStore(() => ({})))
    .handle(async (command) => {
      return [
        workspaceFilesystemScanFailedEvent.create({
          scanId: command.scanId,
          workspaceId: command.workspaceId,
          error: command.error,
        }),
      ];
    });

export default recordWorkspaceFilesystemScanFailed;
