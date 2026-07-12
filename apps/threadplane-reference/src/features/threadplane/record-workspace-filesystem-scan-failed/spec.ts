import { createCommandSlice, event } from "@specter-ts/core/spec";

const recordWorkspaceFilesystemScanFailedSpec = createCommandSlice(
  "recordWorkspaceFilesystemScanFailed",
)
  .description("Records that a workspace filesystem metadata scan failed.")
  .scenarios({
    description: "Records filesystem scan failure with its error message.",
    given: [],
    when: {
      scanId: "scan-1",
      workspaceId: "workspace-1",
      error: "Workspace directory is unavailable",
    },
    expect: [
      event("workspace-filesystem-scan-failed", {
        scanId: "scan-1",
        workspaceId: "workspace-1",
        error: "Workspace directory is unavailable",
      }),
    ],
  });

export default recordWorkspaceFilesystemScanFailedSpec;
