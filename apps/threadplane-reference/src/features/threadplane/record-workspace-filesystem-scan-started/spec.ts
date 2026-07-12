import { createCommandSlice, event } from "@specter-ts/core/spec";

const recordWorkspaceFilesystemScanStartedSpec = createCommandSlice(
  "recordWorkspaceFilesystemScanStarted",
)
  .description("Records that a workspace filesystem metadata scan started.")
  .scenarios({
    description: "Records the start of a requested filesystem scan.",
    given: [
      event("workspace-filesystem-scan-requested", {
        scanId: "scan-1",
        workspaceId: "workspace-1",
        reason: "userRequested",
        requestedBy: { type: "user", displayName: "Ada" },
      }),
    ],
    when: {
      scanId: "scan-1",
      workspaceId: "workspace-1",
    },
    expect: [
      event("workspace-filesystem-scan-started", {
        scanId: "scan-1",
        workspaceId: "workspace-1",
      }),
    ],
  });

export default recordWorkspaceFilesystemScanStartedSpec;
