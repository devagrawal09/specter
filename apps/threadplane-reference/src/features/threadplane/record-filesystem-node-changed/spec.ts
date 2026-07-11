import { createCommandSlice, event } from "@specter-ts/core/spec";

const recordFilesystemNodeChangedSpec = createCommandSlice(
  "recordFilesystemNodeChanged",
)
  .description("Records updated metadata for a workspace filesystem node.")
  .scenarios(
    {
      description: "Records changed metadata for an existing filesystem node.",
      given: [
        event("filesystem-node-discovered", {
          scanId: "scan-1",
          workspaceId: "workspace-1",
          path: "src/index.ts",
          parentPath: "src",
          name: "index.ts",
          kind: "file",
          sizeBytes: 42,
          modifiedAt: "2026-06-13T12:00:00.000Z",
        }),
      ],
      when: {
        scanId: "scan-2",
        workspaceId: "workspace-1",
        path: "src/index.ts",
        parentPath: "src",
        name: "index.ts",
        kind: "file",
        sizeBytes: 84,
        modifiedAt: "2026-06-13T12:01:00.000Z",
      },
      expect: [
        event("filesystem-node-changed", {
          scanId: "scan-2",
          workspaceId: "workspace-1",
          path: "src/index.ts",
          parentPath: "src",
          name: "index.ts",
          kind: "file",
          sizeBytes: 84,
          modifiedAt: "2026-06-13T12:01:00.000Z",
        }),
      ],
    },
    {
      description: "Rejects parent paths that escape the workspace.",
      given: [],
      when: {
        scanId: "scan-1",
        workspaceId: "workspace-1",
        path: "src/index.ts",
        parentPath: "../src",
        name: "index.ts",
        kind: "file",
        sizeBytes: 84,
      },
      expect: [],
      reject: {
        reason: "Filesystem parent path must be relative and normalized",
      },
    },
  );

export default recordFilesystemNodeChangedSpec;
