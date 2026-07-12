import { createQuerySlice, event } from "@specter-ts/core/spec";

const workspaceFilesystemTreeSpec = createQuerySlice("workspaceFilesystemTree")
  .description("Lists normalized filesystem metadata nodes for a workspace.")
  .scenarios(
    {
      description:
        "Lists normalized nodes for one workspace and excludes deleted nodes.",
      given: [
        event("filesystem-node-discovered", {
          scanId: "scan-1",
          workspaceId: "workspace-1",
          path: "src",
          parentPath: null,
          name: "src",
          kind: "directory",
          sizeBytes: null,
        }),
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
        event("filesystem-node-discovered", {
          scanId: "scan-1",
          workspaceId: "workspace-1",
          path: "README.md",
          parentPath: null,
          name: "README.md",
          kind: "file",
          sizeBytes: 12,
        }),
        event("filesystem-node-deleted", {
          scanId: "scan-2",
          workspaceId: "workspace-1",
          path: "README.md",
        }),
        event("filesystem-node-discovered", {
          scanId: "scan-1",
          workspaceId: "workspace-2",
          path: "wrong.txt",
          parentPath: null,
          name: "wrong.txt",
          kind: "file",
          sizeBytes: 1,
        }),
      ],
      when: { workspaceId: "workspace-1" },
      expect: [
        {
          workspaceId: "workspace-1",
          path: "src",
          parentPath: null,
          name: "src",
          kind: "directory",
          sizeBytes: null,
        },
        {
          workspaceId: "workspace-1",
          path: "src/index.ts",
          parentPath: "src",
          name: "index.ts",
          kind: "file",
          sizeBytes: 84,
          modifiedAt: "2026-06-13T12:01:00.000Z",
        },
      ],
    },
    {
      description: "Lists direct children for a selected parent path.",
      given: [
        event("filesystem-node-discovered", {
          scanId: "scan-1",
          workspaceId: "workspace-1",
          path: "src",
          parentPath: null,
          name: "src",
          kind: "directory",
          sizeBytes: null,
        }),
        event("filesystem-node-discovered", {
          scanId: "scan-1",
          workspaceId: "workspace-1",
          path: "src/index.ts",
          parentPath: "src",
          name: "index.ts",
          kind: "file",
          sizeBytes: 42,
        }),
      ],
      when: { workspaceId: "workspace-1", parentPath: "src" },
      expect: [
        {
          workspaceId: "workspace-1",
          path: "src/index.ts",
          parentPath: "src",
          name: "index.ts",
          kind: "file",
          sizeBytes: 42,
        },
      ],
    },
    {
      description:
        "Removes a deleted directory and all descendants from the tree.",
      given: [
        event("filesystem-node-discovered", {
          scanId: "scan-1",
          workspaceId: "workspace-1",
          path: "src",
          parentPath: null,
          name: "src",
          kind: "directory",
          sizeBytes: null,
        }),
        event("filesystem-node-discovered", {
          scanId: "scan-1",
          workspaceId: "workspace-1",
          path: "src/index.ts",
          parentPath: "src",
          name: "index.ts",
          kind: "file",
          sizeBytes: 42,
        }),
        event("filesystem-node-discovered", {
          scanId: "scan-1",
          workspaceId: "workspace-1",
          path: "README.md",
          parentPath: null,
          name: "README.md",
          kind: "file",
          sizeBytes: 12,
        }),
        event("filesystem-node-deleted", {
          scanId: "scan-2",
          workspaceId: "workspace-1",
          path: "src",
        }),
      ],
      when: { workspaceId: "workspace-1" },
      expect: [
        {
          workspaceId: "workspace-1",
          path: "README.md",
          parentPath: null,
          name: "README.md",
          kind: "file",
          sizeBytes: 12,
        },
      ],
    },
  );

export default workspaceFilesystemTreeSpec;
