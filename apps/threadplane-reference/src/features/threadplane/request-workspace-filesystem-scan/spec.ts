import { createCommandSlice, event } from "@specter-ts/core/spec";

const requestWorkspaceFilesystemScanSpec = createCommandSlice(
  "requestWorkspaceFilesystemScan",
)
  .description("Requests a workspace filesystem metadata scan.")
  .scenarios(
    {
      description: "Requests an explicit user-triggered filesystem scan.",
      given: [],
      when: {
        scanId: "scan-1",
        workspaceId: "workspace-1",
        reason: "userRequested",
        requestedBy: { type: "user", userId: "user-1", displayName: "Ada" },
      },
      expect: [
        event("workspace-filesystem-scan-requested", {
          scanId: "scan-1",
          workspaceId: "workspace-1",
          reason: "userRequested",
          requestedBy: { type: "user", userId: "user-1", displayName: "Ada" },
        }),
      ],
    },
    {
      description: "Requests a scan after an agent tool changes files.",
      given: [],
      when: {
        scanId: "scan-2",
        workspaceId: "workspace-1",
        reason: "agentToolChanged",
        requestedBy: {
          type: "agent",
          agentId: "specter",
          displayName: "Specter",
        },
      },
      expect: [
        event("workspace-filesystem-scan-requested", {
          scanId: "scan-2",
          workspaceId: "workspace-1",
          reason: "agentToolChanged",
          requestedBy: {
            type: "agent",
            agentId: "specter",
            displayName: "Specter",
          },
        }),
      ],
    },
  );

export default requestWorkspaceFilesystemScanSpec;
