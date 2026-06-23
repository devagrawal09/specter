# Specter OpenCode Clone Implementation Plan

> **For Hermes:** Use subagent-driven-development skill to implement this plan task-by-task.

**Goal:** Build a faithful OpenCode-style coding agent product on top of Specter, using Specter as the durable event/workflow backbone and local adapters for LLMs, tools, permissions, filesystem, shell, LSP, config, and UI/CLI surfaces.

**Architecture:** Create a new app, `apps/specter-code`, by extracting/reusing the Threadplane reference app's workspace/chat/filesystem/agent-run patterns instead of rewriting `@specter-ts/core`. Specter events model every user action, assistant message, tool call, permission decision, file edit, shell run, PTY session, and sync/share action; command/query/reaction slices provide validated state transitions and read models; app-local adapters perform side effects outside pure slices.

**Tech Stack:** TypeScript, PNPM workspaces, `@specter-ts/core`, Solid/TanStack Start, Zod/Standard Schema, SQLite/libsql, Vitest scenario tests, Playwright, AI SDK-compatible providers, `node-pty`/Bun subprocesses, ripgrep, LSP clients, MCP SDK, SSE/WebSocket streaming.

---

## Research Summary

### Specter repository

Target repo:

```txt
/home/lucifer/work/active/specter
```

Current state observed on 2026-06-22:

```txt
branch: threadplane-work
HEAD: 8ba8053 Refine Threadplane reference UI
working tree: dirty only in .opencode/agent/*.md plus untracked .hermes/
```

Important packages/apps:

```txt
packages/core                         # @specter-ts/core runtime
packages/create-specter                # create-specter CLI/template
apps/threadplane-reference             # best current OpenCode-like scaffold
apps/reference                         # smaller todo reference
apps/booking-reference                 # booking workflow reference
```

Most reusable app:

```txt
apps/threadplane-reference
```

Already present and directly relevant:

- Workspaces.
- Chat/posts/replies.
- Filesystem scan/status/tree/read-only preview.
- Agent-run lifecycle.
- Tool-call lifecycle.
- Streamed assistant chunks as events.
- Reaction-driven simulated agent run.
- SQLite event log + slice-state persistence.
- Server-only runtime boundary.
- Solid UI + polling resources.
- Vitest scenario tests and Playwright e2e tests.

Key Threadplane files to reuse or copy:

```txt
apps/threadplane-reference/src/features/threadplane/events.ts
apps/threadplane-reference/src/features/threadplane/registry.ts
apps/threadplane-reference/src/features/threadplane/server-runtime.server.ts
apps/threadplane-reference/src/features/threadplane/server-functions.ts
apps/threadplane-reference/src/features/threadplane/simulated-agent-plan.ts
apps/threadplane-reference/src/features/threadplane/run-requested-agent-run/slice.ts
apps/threadplane-reference/src/features/threadplane/agent-run-timeline/slice.ts
apps/threadplane-reference/src/features/threadplane/workspace-chat/slice.ts
apps/threadplane-reference/src/features/threadplane/workspace-filesystem-tree/slice.ts
apps/threadplane-reference/src/features/threadplane/filesystem-metadata-adapter.ts
apps/threadplane-reference/src/db/specter-sqlite.ts
apps/threadplane-reference/src/testing/*.ts
apps/threadplane-reference/tests/e2e/*.spec.ts
```

Core rules to preserve:

- Events first.
- Slice state is private to each slice.
- Slices must not import sibling slices.
- Effects belong in reaction plugins/adapters, not in pure command/query handlers.
- UI/server functions should not import database details directly.
- `@specter-ts/core` should remain storage/UI/transport agnostic.

### OpenCode clone reference

Local OpenCode clone inspected:

```txt
/home/lucifer/work/active/harlan/.repos/opencode
HEAD: ca8f578 ci: skip previously cleaned PRs (#27670)
status: clean
```

OpenCode is a large Bun/TypeScript monorepo. Important packages:

```txt
packages/opencode                   # main CLI/server/runtime
packages/app                        # Solid web app
packages/core                       # core provider/session/shared primitives
packages/llm                        # low-level LLM utilities
packages/plugin                     # plugin SDK/runtime types
packages/sdk                        # generated SDK + openapi.json
packages/ui                         # shared UI package
```

Main OpenCode surfaces to clone:

- CLI entrypoint with commands: default TUI, `run`, `serve`, `web`, `session`, `agent`, `providers`, `models`, `mcp`, `github`, `pr`, `import`, `export`, `db`, `debug`, `upgrade`, `uninstall`, `attach`, ACP.
- Headless HTTP server with OpenAPI/SDK.
- Event stream/global bus.
- Session/message/part persistence.
- Prompt processing and resumable turns.
- LLM provider/model registry.
- Agents/modes/subagents.
- Tools: read, write, edit, apply_patch, shell, glob, grep, LSP, task/subtask, todo, webfetch, websearch, repo clone/overview, skill, question.
- Permission system: allow/ask/deny rules with wildcard matching and pending requests.
- PTY sessions and terminal streaming.
- File/status/search APIs.
- Git/VCS diff/status/apply/revert/snapshots.
- LSP diagnostics/symbol lookup.
- MCP server support.
- Config loader from global/project `.opencode` locations with JSONC, plugins, agents, skills, provider definitions.
- Web app/TUI with session transcript, model selection, tool timeline, diffs, approvals, subagent status, prompt queue.

OpenCode's generated OpenAPI endpoints include:

```txt
GET /agent
GET /command
GET,PATCH /config
GET /event
GET /file
GET /file/content
GET /file/status
GET /find
GET /find/file
GET /find/symbol
GET /formatter
GET /lsp
GET,POST /mcp
GET /permission
POST /permission/{requestID}/reply
GET /project
GET /provider
GET,POST /pty
GET,PUT,DELETE /pty/{ptyID}
GET /question
GET,POST /session
GET /session/status
GET,DELETE,PATCH /session/{sessionID}
POST /session/{sessionID}/abort
GET /session/{sessionID}/children
POST /session/{sessionID}/command
GET /session/{sessionID}/diff
POST /session/{sessionID}/fork
POST /session/{sessionID}/init
GET,POST /session/{sessionID}/message
DELETE,PATCH /session/{sessionID}/message/{messageID}/part/{partID}
POST /session/{sessionID}/prompt_async
POST /session/{sessionID}/revert
GET /session/{sessionID}/todo
POST /session/{sessionID}/summarize
GET /skill
POST /sync/*
POST /tui/*
GET /vcs
POST /vcs/apply
GET /vcs/diff
GET /vcs/status
```

### Existing Specter/OpenCode experiments

There is no real OpenCode clone under `/home/lucifer/work/active/specter-opencode`; it contains Specter experiment branches:

```txt
/home/lucifer/work/active/specter-opencode/booking
/home/lucifer/work/active/specter-opencode/docs
/home/lucifer/work/active/specter-opencode/inventory
```

Useful reusable experiment sources:

```txt
/home/lucifer/work/active/specter-demo-local             # combined branch through docs/booking/inventory/template fixes
/home/lucifer/work/active/specter-opencode/inventory     # full inventory reference app scaffold
/home/lucifer/work/active/specter-opencode/docs/docs/slice-authoring-workflow.md
```

Use these as examples only; the OpenCode clone should primarily start from `apps/threadplane-reference` in the target repo.

---

## Product Scope and Definition of Done

The clone is considered complete when it can replace a normal OpenCode workflow for local coding work:

1. From a project directory, the user can launch an interactive terminal UI or web UI.
2. The app can create, resume, fork, rename, delete, import, export, summarize, compact, revert, and share sessions.
3. The assistant can stream tokens, call tools, request approvals, run shell commands, edit files, apply patches, inspect git diffs/status, search files, query LSP, use web fetch/search when configured, and spawn subagents/tasks.
4. Provider/model/agent/tool/permission/config semantics are compatible enough with OpenCode `.opencode` projects for practical migration.
5. Sessions, messages, parts, tool outputs, permissions, todos, diffs, snapshots, and PTY state are durable in SQLite.
6. API routes cover OpenCode's important HTTP/SDK surfaces.
7. UI/TUI present session history, prompt input, model/agent selection, file references, tool timelines, diffs, approvals, PTY, todos, and subagent status.
8. All critical behavior is covered by Specter scenario tests, adapter unit tests, API tests, and Playwright/TUI smoke tests.

---

## Proposed File Layout

Create a new app instead of overloading Threadplane:

```txt
apps/specter-code/
  package.json
  tsconfig.json
  vite.config.ts
  playwright.config.ts
  drizzle.config.ts
  src/
    client.tsx
    server.ts
    router.tsx
    routeTree.gen.ts
    routes/
      index.tsx
      sessions.$sessionId.tsx
      settings.tsx
    db/
      client.server.ts
      schema.ts
      specter-schema.ts
      specter-sqlite.ts
      specter-sqlite.test.ts
    features/specter-code/
      events.ts
      registry.ts
      server-functions.ts
      server-runtime.server.ts
      scenarios.test.ts
      adapters/
        agent-runtime.ts
        config-loader.ts
        event-stream.ts
        file-index.ts
        git.ts
        llm-provider.ts
        lsp.ts
        mcp.ts
        permissions.ts
        pty.ts
        shell.ts
        snapshots.ts
        tool-registry.ts
      domain/
        ids.ts
        schemas.ts
        openapi-compat.ts
      slices/
        create-session/slice.ts
        update-session/slice.ts
        delete-session/slice.ts
        fork-session/slice.ts
        submit-prompt/slice.ts
        run-requested-agent-turn/slice.ts
        record-assistant-message-started/slice.ts
        record-assistant-message-streamed/slice.ts
        record-assistant-message-completed/slice.ts
        record-assistant-message-failed/slice.ts
        record-tool-call-started/slice.ts
        record-tool-call-output-streamed/slice.ts
        record-tool-call-completed/slice.ts
        record-tool-call-failed/slice.ts
        request-tool-approval/slice.ts
        reply-tool-approval/slice.ts
        abort-session/slice.ts
        compact-session/slice.ts
        summarize-session/slice.ts
        revert-session/slice.ts
        record-file-edit/slice.ts
        record-shell-run/slice.ts
        record-pty-event/slice.ts
        update-todo-list/slice.ts
        session-list/slice.ts
        session-transcript/slice.ts
        session-status/slice.ts
        agent-run-timeline/slice.ts
        pending-permissions/slice.ts
        workspace-file-tree/slice.ts
        workspace-file-content/slice.ts
        workspace-diff/slice.ts
        provider-list/slice.ts
        agent-list/slice.ts
        tool-list/slice.ts
      ui/
        AppShell.tsx
        SessionView.tsx
        Transcript.tsx
        PromptBox.tsx
        ToolTimeline.tsx
        ApprovalPanel.tsx
        DiffPanel.tsx
        FileExplorer.tsx
        ModelSelector.tsx
        AgentSelector.tsx
        PtyTerminal.tsx
      cli/
        index.ts
        commands/run.ts
        commands/serve.ts
        commands/session.ts
        commands/config.ts
        commands/models.ts
        commands/providers.ts
      tests/
        openapi-compat.test.ts
        agent-runtime.test.ts
        tool-registry.test.ts
        permissions.test.ts
        config-loader.test.ts
        pty.test.ts
  tests/e2e/
    chat.spec.ts
    approval.spec.ts
    file-edit.spec.ts
    shell.spec.ts
    resume.spec.ts
```

Add workspace integration:

```txt
package.json                         # root scripts for dev:specter-code, test:specter-code if desired
pnpm-workspace.yaml                  # already covers apps/*
```

Do not move logic into `packages/core` unless the clone reveals a general Specter runtime need.

---

## Implementation Plan

### Phase 0: Guardrails and baseline

#### Task 0.1: Snapshot current repo state

**Objective:** Avoid overwriting unrelated local changes.

**Files:** none.

**Steps:**

1. Run:

   ```sh
   cd /home/lucifer/work/active/specter
   git status --short
   git branch --show-current
   git log -1 --oneline
   ```

2. Expected current known status:

   ```txt
    M .opencode/agent/intern.md
    M .opencode/agent/junior.md
    M .opencode/agent/senior.md
   ?? .hermes/
   ```

3. If additional changes appear, inspect them before editing.

#### Task 0.2: Establish verification commands

**Objective:** Make a single repeatable check set for the new app.

**Files:**

- Modify: `package.json`
- Create later: `apps/specter-code/package.json`

**Commands:**

```sh
cd /home/lucifer/work/active/specter
pnpm install
pnpm build
pnpm typecheck
pnpm test
```

After `apps/specter-code` exists, add:

```sh
pnpm --filter @specter/specter-code typecheck
pnpm --filter @specter/specter-code test
pnpm --filter @specter/specter-code build
pnpm --filter @specter/specter-code test:e2e
```

---

### Phase 1: Create the app skeleton from Threadplane

#### Task 1.1: Copy Threadplane into `apps/specter-code`

**Objective:** Start from the closest working Specter-native app.

**Files:**

- Copy from: `apps/threadplane-reference/**`
- Create: `apps/specter-code/**`

**Steps:**

1. Copy app structure.
2. Rename package from `@specter/threadplane-reference` to `@specter/specter-code`.
3. Rename user-facing labels from Threadplane to Specter Code.
4. Keep all tests initially passing before domain refactor.

**Verification:**

```sh
pnpm --filter @specter/specter-code typecheck
pnpm --filter @specter/specter-code test
pnpm --filter @specter/specter-code build
```

Expected: pass or only package-name/import path failures that are fixed in this task.

#### Task 1.2: Rename feature namespace without changing behavior

**Objective:** Move from `features/threadplane` to `features/specter-code` while preserving behavior.

**Files:**

- Move: `apps/specter-code/src/features/threadplane/**` -> `apps/specter-code/src/features/specter-code/**`
- Modify imports in `apps/specter-code/src/**`

**Verification:**

```sh
pnpm --filter @specter/specter-code typecheck
pnpm --filter @specter/specter-code test
```

#### Task 1.3: Add root dev script

**Objective:** Make the app easy to launch.

**Files:**

- Modify: `package.json`

**Change:**

Add:

```json
{
  "scripts": {
    "dev:specter-code": "pnpm --filter @specter/specter-code dev"
  }
}
```

**Verification:**

```sh
pnpm dev:specter-code
```

Expected: app starts on its configured strict port.

---

### Phase 2: Domain schema and event vocabulary

#### Task 2.1: Add stable ID/domain schema helpers

**Objective:** Standardize IDs and shared schemas before adding many slices.

**Files:**

- Create: `apps/specter-code/src/features/specter-code/domain/ids.ts`
- Create: `apps/specter-code/src/features/specter-code/domain/schemas.ts`
- Modify: `apps/specter-code/src/features/specter-code/events.ts`

**Include IDs:**

```ts
export type WorkspaceId = string
export type SessionId = string
export type MessageId = string
export type PartId = string
export type ToolCallId = string
export type PermissionRequestId = string
export type PtyId = string
export type SnapshotId = string
```

**Verification:**

```sh
pnpm --filter @specter/specter-code typecheck
```

#### Task 2.2: Replace Threadplane post events with session/message events

**Objective:** Model OpenCode sessions and message parts.

**Files:**

- Modify: `apps/specter-code/src/features/specter-code/events.ts`
- Modify tests that reference `postCreated` / `postReplyCreated`

**Add event definitions:**

```txt
workspaceOpened
sessionCreated
sessionUpdated
sessionDeleted
sessionForked
userMessageSubmitted
assistantMessageStarted
assistantMessageStreamed
assistantMessageCompleted
assistantMessageFailed
messagePartCreated
messagePartUpdated
messagePartDeleted
sessionAborted
sessionCompactionRequested
sessionCompacted
sessionSummaryRequested
sessionSummarized
```

**Verification:**

```sh
pnpm --filter @specter/specter-code test -- features/specter-code/scenarios.test.ts
```

#### Task 2.3: Add tool/permission/file/shell events

**Objective:** Make side-effect execution auditable.

**Files:**

- Modify: `apps/specter-code/src/features/specter-code/events.ts`

**Add event definitions:**

```txt
toolCallStarted
toolCallOutputStreamed
toolCallCompleted
toolCallFailed
toolApprovalRequested
toolApprovalReplied
fileReadRecorded
fileEditProposed
fileEditApplied
fileEditRejected
shellCommandStarted
shellCommandOutputStreamed
shellCommandCompleted
shellCommandFailed
ptyCreated
ptyDataStreamed
ptyInputSent
ptyResized
ptyExited
snapshotCreated
snapshotRestored
gitStatusRecorded
gitDiffRecorded
todoListUpdated
```

**Verification:**

```sh
pnpm --filter @specter/specter-code typecheck
```

---

### Phase 3: Core session slices

#### Task 3.1: Implement `createSession`

**Objective:** Create an OpenCode-like session in a workspace.

**Files:**

- Create: `apps/specter-code/src/features/specter-code/slices/create-session/slice.ts`
- Modify: `apps/specter-code/src/features/specter-code/registry.ts`
- Test: `apps/specter-code/src/features/specter-code/scenarios.test.ts`

**Test first:**

```ts
it("creates a session with title, directory, agent and model", async () => {
  const app = createTestSpecterCodeApp()
  const result = await app.createSession({
    workspaceId: "wsp_test",
    sessionId: "ses_test",
    title: "Fix tests",
    directory: "/tmp/project",
    agent: "build",
    model: { providerId: "anthropic", modelId: "claude-sonnet-4" },
  })
  expect(result.sessionId).toBe("ses_test")
  await expect(app.sessionList({ workspaceId: "wsp_test" })).resolves.toContainEqual(
    expect.objectContaining({ id: "ses_test", title: "Fix tests" }),
  )
})
```

**Verification:**

```sh
pnpm --filter @specter/specter-code test -- features/specter-code/scenarios.test.ts
```

#### Task 3.2: Implement `sessionList` and `sessionTranscript` query slices

**Objective:** Provide read models for UI/API.

**Files:**

- Create: `slices/session-list/slice.ts`
- Create: `slices/session-transcript/slice.ts`
- Modify: `registry.ts`
- Test: `scenarios.test.ts`

**Verification:**

```sh
pnpm --filter @specter/specter-code test -- features/specter-code/scenarios.test.ts
```

#### Task 3.3: Implement `submitPrompt`

**Objective:** Record user messages and request an agent turn.

**Files:**

- Create: `slices/submit-prompt/slice.ts`
- Modify: `registry.ts`
- Test: `scenarios.test.ts`

**Expected events:**

```txt
userMessageSubmitted
agentRunRequested
```

**Verification:**

```sh
pnpm --filter @specter/specter-code test -- features/specter-code/scenarios.test.ts
```

#### Task 3.4: Implement run/timeline query slices

**Objective:** Display assistant generation and tools as a chronological timeline.

**Files:**

- Create/modify: `slices/agent-run-timeline/slice.ts`
- Create: `slices/session-status/slice.ts`
- Test: `slices/agent-run-timeline/*.test.ts`

**Verification:**

```sh
pnpm --filter @specter/specter-code test -- features/specter-code/slices/agent-run-timeline
```

---

### Phase 4: Agent runtime adapter, streaming, and fake-to-real replacement

#### Task 4.1: Define the agent runtime adapter interface

**Objective:** Keep LLM side effects outside Specter slices.

**Files:**

- Create: `apps/specter-code/src/features/specter-code/adapters/agent-runtime.ts`

**Interface:**

```ts
export interface AgentRuntime {
  runTurn(input: AgentTurnInput, sink: AgentTurnSink): Promise<AgentTurnResult>
  abort(runId: string): Promise<void>
}

export interface AgentTurnSink {
  assistantStarted(input: { messageId: string }): Promise<void>
  assistantDelta(input: { messageId: string; text: string }): Promise<void>
  assistantCompleted(input: { messageId: string }): Promise<void>
  toolStarted(input: ToolStarted): Promise<void>
  toolOutput(input: ToolOutputDelta): Promise<void>
  toolCompleted(input: ToolCompleted): Promise<void>
  toolFailed(input: ToolFailed): Promise<void>
  approvalRequested(input: ToolApprovalRequest): Promise<void>
}
```

**Verification:**

```sh
pnpm --filter @specter/specter-code typecheck
```

#### Task 4.2: Replace `simulated-agent-plan` with adapter-driven reaction

**Objective:** Turn `runRequestedAgentRun` into a real orchestration boundary.

**Files:**

- Modify: `slices/run-requested-agent-turn/slice.ts`
- Delete or quarantine: `simulated-agent-plan.ts`
- Test: `run-requested-agent-turn/scenarios.test.ts`

**Approach:**

- Command emits `agentRunRequested`.
- Reaction catches request.
- Reaction plugin calls `AgentRuntime.runTurn`.
- Runtime sink calls app commands to record deltas/tools/failures.

**Verification:**

```sh
pnpm --filter @specter/specter-code test -- features/specter-code/slices/run-requested-agent-turn
```

#### Task 4.3: Add a deterministic fake runtime for tests

**Objective:** Make scenario tests deterministic while real adapters evolve.

**Files:**

- Create: `apps/specter-code/src/features/specter-code/testing/fake-agent-runtime.ts`
- Modify: `testing/create-test-app.ts`

**Verification:**

```sh
pnpm --filter @specter/specter-code test
```

#### Task 4.4: Add AI SDK provider runtime

**Objective:** Connect real LLM streaming with tool calls.

**Files:**

- Create: `adapters/llm-provider.ts`
- Create: `adapters/ai-sdk-agent-runtime.ts`
- Test: `tests/agent-runtime.test.ts`

**Initial provider support:**

- OpenAI-compatible.
- Anthropic via AI SDK.
- OpenRouter via AI SDK/OpenAI-compatible.
- Provider/model passed from config.

**Verification:**

```sh
pnpm --filter @specter/specter-code test -- src/features/specter-code/tests/agent-runtime.test.ts
```

Do not require real API keys in default CI tests; use a mocked stream.

---

### Phase 5: Tool registry and core tools

#### Task 5.1: Define `ToolRegistry` and `ToolContext`

**Objective:** Clone OpenCode's extensible tool shape in app-local code.

**Files:**

- Create: `adapters/tool-registry.ts`
- Create: `features/specter-code/tools/tool.ts`
- Test: `tests/tool-registry.test.ts`

**Required context:**

```ts
sessionId
messageId
agent
workspaceRoot
abortSignal
ask(permissionRequest)
metadata(update)
```

**Verification:**

```sh
pnpm --filter @specter/specter-code test -- src/features/specter-code/tests/tool-registry.test.ts
```

#### Task 5.2: Implement read/search tools

**Objective:** Provide safe inspect-only tooling.

**Files:**

- Create: `tools/read.ts`
- Create: `tools/glob.ts`
- Create: `tools/grep.ts`
- Modify: `adapters/file-index.ts`
- Test: `tests/tools-read-search.test.ts`

**Rules:**

- Normalize paths.
- Block path escape.
- Block or carefully handle symlinks.
- Limit output size.
- Mark truncated outputs.

**Verification:**

```sh
pnpm --filter @specter/specter-code test -- src/features/specter-code/tests/tools-read-search.test.ts
```

#### Task 5.3: Implement write/edit/apply_patch tools

**Objective:** Support coding changes with audit and reversible snapshots.

**Files:**

- Create: `tools/write.ts`
- Create: `tools/edit.ts`
- Create: `tools/apply-patch.ts`
- Modify: `adapters/snapshots.ts`
- Test: `tests/tools-edit.test.ts`

**Rules:**

- Create snapshot before mutating.
- Emit `fileEditProposed` for approval-required policies.
- Emit `fileEditApplied` only after successful write.
- Surface patch hunks in timeline/UI.

**Verification:**

```sh
pnpm --filter @specter/specter-code test -- src/features/specter-code/tests/tools-edit.test.ts
```

#### Task 5.4: Implement shell tool

**Objective:** Run bounded shell commands with streaming output.

**Files:**

- Create: `tools/shell.ts`
- Create: `adapters/shell.ts`
- Test: `tests/tools-shell.test.ts`

**Rules:**

- Use configured shell.
- Enforce working directory containment unless external directory is explicitly allowed.
- Stream stdout/stderr as `shellCommandOutputStreamed`.
- Enforce timeout and max output.
- Request approval according to permission policy.

**Verification:**

```sh
pnpm --filter @specter/specter-code test -- src/features/specter-code/tests/tools-shell.test.ts
```

#### Task 5.5: Implement todo, question, webfetch/websearch, task/subagent tools

**Objective:** Reach parity with common OpenCode agent workflows.

**Files:**

```txt
tools/todo.ts
tools/question.ts
tools/webfetch.ts
tools/websearch.ts
tools/task.ts
tools/task-status.ts
```

**Verification:**

```sh
pnpm --filter @specter/specter-code test -- src/features/specter-code/tests/tools-*.test.ts
```

---

### Phase 6: Permissions, approvals, and safety

#### Task 6.1: Implement wildcard permission evaluator

**Objective:** Clone OpenCode's allow/ask/deny policy semantics.

**Files:**

- Create: `adapters/permissions.ts`
- Create: `slices/request-tool-approval/slice.ts`
- Create: `slices/reply-tool-approval/slice.ts`
- Create: `slices/pending-permissions/slice.ts`
- Test: `tests/permissions.test.ts`

**Rules:**

- Most recent matching rule wins.
- Default action is `ask`.
- Rules include `{ permission, pattern, action }`.

**Verification:**

```sh
pnpm --filter @specter/specter-code test -- src/features/specter-code/tests/permissions.test.ts
```

#### Task 6.2: Wire approvals into tool execution

**Objective:** Pause tool execution when policy says `ask`.

**Files:**

- Modify: `adapters/tool-registry.ts`
- Modify: `adapters/agent-runtime.ts`
- Modify: `ui/ApprovalPanel.tsx`
- Test: `tests/approval-flow.test.ts`

**Verification:**

```sh
pnpm --filter @specter/specter-code test -- src/features/specter-code/tests/approval-flow.test.ts
pnpm --filter @specter/specter-code test:e2e -- approval.spec.ts
```

---

### Phase 7: Persistence and large transcript storage

#### Task 7.1: Extend SQLite schema for sessions/messages/parts/artifacts

**Objective:** Avoid keeping huge transcripts only in Specter slice JSON blobs.

**Files:**

- Modify: `apps/specter-code/src/db/schema.ts`
- Modify: `apps/specter-code/src/db/specter-schema.ts`
- Modify: `apps/specter-code/src/db/specter-sqlite.ts`
- Add migration(s) under `apps/specter-code/drizzle/`
- Test: `apps/specter-code/src/db/specter-sqlite.test.ts`

**Tables:**

```txt
specter_code_sessions
specter_code_messages
specter_code_message_parts
specter_code_tool_calls
specter_code_permissions
specter_code_todos
specter_code_snapshots
specter_code_artifacts
specter_code_pty_sessions
```

**Verification:**

```sh
pnpm --filter @specter/specter-code test -- src/db/specter-sqlite.test.ts
```

#### Task 7.2: Add migration from event-only state to table-backed read models

**Objective:** Keep Specter events authoritative while making UI queries fast.

**Files:**

- Modify query slices to hydrate table-backed projections.
- Add projection tests.

**Verification:**

```sh
pnpm --filter @specter/specter-code test -- src/features/specter-code
```

---

### Phase 8: API compatibility layer

#### Task 8.1: Generate route inventory from OpenCode `openapi.json`

**Objective:** Track parity explicitly.

**Files:**

- Create: `apps/specter-code/src/features/specter-code/domain/openapi-compat.ts`
- Create: `apps/specter-code/src/features/specter-code/tests/openapi-compat.test.ts`

**Data source:**

```txt
/home/lucifer/work/active/harlan/.repos/opencode/packages/sdk/openapi.json
```

**Verification:**

```sh
pnpm --filter @specter/specter-code test -- src/features/specter-code/tests/openapi-compat.test.ts
```

#### Task 8.2: Implement core session/config/provider/file routes

**Objective:** Make SDK/web/TUI clients independent from server internals.

**Files:**

- Modify: `server-functions.ts`
- Create: `server-routes.ts` or TanStack Start server route modules as appropriate.

**Initial endpoints:**

```txt
GET,POST /session
GET,DELETE,PATCH /session/:sessionID
GET,POST /session/:sessionID/message
POST /session/:sessionID/prompt_async
POST /session/:sessionID/abort
GET /session/status
GET,PATCH /config
GET /provider
GET /agent
GET /file
GET /file/content
GET /file/status
GET /permission
POST /permission/:requestID/reply
```

**Verification:**

```sh
pnpm --filter @specter/specter-code test -- src/features/specter-code/tests/api-routes.test.ts
```

#### Task 8.3: Add SSE/WebSocket event stream

**Objective:** Replace Threadplane polling with real OpenCode-style streaming.

**Files:**

- Create: `adapters/event-stream.ts`
- Modify: `server-runtime.server.ts`
- Modify: UI hooks.
- Test: `tests/event-stream.test.ts`

**Verification:**

```sh
pnpm --filter @specter/specter-code test -- src/features/specter-code/tests/event-stream.test.ts
```

---

### Phase 9: Config, providers, agents, skills, plugins

#### Task 9.1: Implement JSONC config loader

**Objective:** Read OpenCode-compatible project/global config.

**Files:**

- Create: `adapters/config-loader.ts`
- Create: `domain/config-schema.ts`
- Test: `tests/config-loader.test.ts`

**Support:**

```txt
.opencode/opencode.jsonc
opencode.jsonc
global config under app data
provider/model/default_agent/agent/permission/mcp/plugin/skills/reference/formatter/watcher/shell
```

**Verification:**

```sh
pnpm --filter @specter/specter-code test -- src/features/specter-code/tests/config-loader.test.ts
```

#### Task 9.2: Implement provider/model registry

**Objective:** Support model selection and provider auth setup.

**Files:**

- Create: `adapters/llm-provider.ts`
- Create: `slices/provider-list/slice.ts`
- Create: `ui/ModelSelector.tsx`
- Test: `tests/provider-registry.test.ts`

**Support initially:**

- Environment key discovery.
- Custom OpenAI-compatible providers.
- OpenRouter.
- Anthropic/OpenAI via AI SDK where available.

**Verification:**

```sh
pnpm --filter @specter/specter-code test -- src/features/specter-code/tests/provider-registry.test.ts
```

#### Task 9.3: Implement agents/modes/subagents

**Objective:** Clone primary/subagent agent configuration.

**Files:**

- Create: `slices/agent-list/slice.ts`
- Create: `ui/AgentSelector.tsx`
- Modify: `adapters/agent-runtime.ts`
- Test: `tests/agents.test.ts`

**Verification:**

```sh
pnpm --filter @specter/specter-code test -- src/features/specter-code/tests/agents.test.ts
```

#### Task 9.4: Add plugin and custom tool loading

**Objective:** Support `.opencode/tool/*.ts` and plugin tool definitions.

**Files:**

- Create: `adapters/plugin-loader.ts`
- Modify: `adapters/tool-registry.ts`
- Test: `tests/plugins.test.ts`

**Verification:**

```sh
pnpm --filter @specter/specter-code test -- src/features/specter-code/tests/plugins.test.ts
```

---

### Phase 10: Filesystem, git, snapshots, LSP, MCP, PTY

#### Task 10.1: Upgrade filesystem tree/status/search

**Objective:** Match OpenCode file APIs.

**Files:**

- Modify: `adapters/file-index.ts`
- Create/modify: `slices/workspace-file-tree/slice.ts`
- Create: `slices/workspace-file-content/slice.ts`
- Test: `tests/filesystem.test.ts`

**Verification:**

```sh
pnpm --filter @specter/specter-code test -- src/features/specter-code/tests/filesystem.test.ts
```

#### Task 10.2: Implement git/VCS adapter

**Objective:** Expose status, diff, apply, revert helpers.

**Files:**

- Create: `adapters/git.ts`
- Create: `slices/workspace-diff/slice.ts`
- Test: `tests/git.test.ts`

**Verification:**

```sh
pnpm --filter @specter/specter-code test -- src/features/specter-code/tests/git.test.ts
```

#### Task 10.3: Implement snapshots and revert

**Objective:** Allow safe undo of agent changes.

**Files:**

- Create: `adapters/snapshots.ts`
- Create: `slices/revert-session/slice.ts`
- Test: `tests/snapshots.test.ts`

**Verification:**

```sh
pnpm --filter @specter/specter-code test -- src/features/specter-code/tests/snapshots.test.ts
```

#### Task 10.4: Implement LSP adapter/tool

**Objective:** Support diagnostics and symbol lookup.

**Files:**

- Create: `adapters/lsp.ts`
- Create: `tools/lsp.ts`
- Test: `tests/lsp.test.ts`

**Verification:**

```sh
pnpm --filter @specter/specter-code test -- src/features/specter-code/tests/lsp.test.ts
```

#### Task 10.5: Implement MCP adapter/tool registry bridge

**Objective:** Expose MCP tools/resources/prompts.

**Files:**

- Create: `adapters/mcp.ts`
- Modify: `adapters/tool-registry.ts`
- Test: `tests/mcp.test.ts`

**Verification:**

```sh
pnpm --filter @specter/specter-code test -- src/features/specter-code/tests/mcp.test.ts
```

#### Task 10.6: Implement PTY sessions

**Objective:** Clone OpenCode terminal process support.

**Files:**

- Create: `adapters/pty.ts`
- Create: `slices/record-pty-event/slice.ts`
- Create: `ui/PtyTerminal.tsx`
- Test: `tests/pty.test.ts`

**Verification:**

```sh
pnpm --filter @specter/specter-code test -- src/features/specter-code/tests/pty.test.ts
```

---

### Phase 11: Web UI parity

#### Task 11.1: Build app shell and session list

**Objective:** Replace Threadplane UI copy with coding-agent UI.

**Files:**

- Create/modify: `ui/AppShell.tsx`
- Create/modify: `routes/index.tsx`
- Create: `ui/SessionList.tsx`
- Test: `tests/e2e/chat.spec.ts`

**Verification:**

```sh
pnpm --filter @specter/specter-code test:e2e -- chat.spec.ts
```

#### Task 11.2: Build transcript and prompt box

**Objective:** Support actual conversation flow.

**Files:**

- Create: `ui/Transcript.tsx`
- Create: `ui/PromptBox.tsx`
- Modify: `routes/sessions.$sessionId.tsx`

**Verification:**

```sh
pnpm --filter @specter/specter-code test:e2e -- chat.spec.ts
```

#### Task 11.3: Build tool timeline, approvals, diff/file panels

**Objective:** Make agent work inspectable and controllable.

**Files:**

```txt
ui/ToolTimeline.tsx
ui/ApprovalPanel.tsx
ui/DiffPanel.tsx
ui/FileExplorer.tsx
```

**Verification:**

```sh
pnpm --filter @specter/specter-code test:e2e -- approval.spec.ts file-edit.spec.ts shell.spec.ts
```

#### Task 11.4: Add model/agent/config settings UI

**Objective:** Match common OpenCode controls.

**Files:**

```txt
ui/ModelSelector.tsx
ui/AgentSelector.tsx
routes/settings.tsx
```

**Verification:**

```sh
pnpm --filter @specter/specter-code test:e2e -- settings.spec.ts
```

---

### Phase 12: CLI and TUI surfaces

#### Task 12.1: Add CLI entrypoint

**Objective:** Start cloning OpenCode CLI behavior.

**Files:**

- Create: `apps/specter-code/src/features/specter-code/cli/index.ts`
- Create: `apps/specter-code/src/features/specter-code/cli/commands/run.ts`
- Create: `apps/specter-code/src/features/specter-code/cli/commands/serve.ts`
- Modify: `apps/specter-code/package.json`

**Commands:**

```txt
specter-code
specter-code run [message]
specter-code serve
specter-code session list
specter-code providers
specter-code models
```

**Verification:**

```sh
pnpm --filter @specter/specter-code build
node apps/specter-code/dist/cli/index.js --help
```

#### Task 12.2: Add non-interactive `run` mode

**Objective:** Send one prompt, stream output, exit idle.

**Files:**

- Modify: `cli/commands/run.ts`
- Test: `tests/cli-run.test.ts`

**Verification:**

```sh
node apps/specter-code/dist/cli/index.js run --format json "say hi"
```

With mocked provider: emits JSON events and exits 0.

#### Task 12.3: Add interactive TUI MVP

**Objective:** Terminal UI for session transcript + prompt + approvals.

**Files:**

- Create: `cli/tui/*`
- Test: `tests/tui-smoke.test.ts`

**Approach:**

- Reuse web/API/domain state.
- Start with Ink/Blessed/OpenTUI depending on dependency decision.
- Mirror OpenCode key flows: prompt, interrupt, approve/reject, switch session/model.

**Verification:**

```sh
node apps/specter-code/dist/cli/index.js --help
node apps/specter-code/dist/cli/index.js run --interactive --demo
```

Manual smoke: create session, submit prompt, see streamed fake runtime output, approve a fake tool.

---

### Phase 13: OpenCode migration compatibility

#### Task 13.1: Import `.opencode` project config

**Objective:** Let existing OpenCode projects run in Specter Code.

**Files:**

- Modify: `adapters/config-loader.ts`
- Add fixture: `tests/fixtures/opencode-project/.opencode/opencode.jsonc`
- Test: `tests/opencode-config-compat.test.ts`

**Verification:**

```sh
pnpm --filter @specter/specter-code test -- src/features/specter-code/tests/opencode-config-compat.test.ts
```

#### Task 13.2: Import/export sessions

**Objective:** Move session history between OpenCode and Specter Code.

**Files:**

- Create: `adapters/import-export.ts`
- Create CLI commands: `cli/commands/import.ts`, `cli/commands/export.ts`
- Test: `tests/import-export.test.ts`

**Verification:**

```sh
node apps/specter-code/dist/cli/index.js export --session ses_test --output /tmp/session.json
node apps/specter-code/dist/cli/index.js import /tmp/session.json
```

#### Task 13.3: Route parity checklist

**Objective:** Make endpoint gaps explicit and keep shrinking them.

**Files:**

- Modify: `domain/openapi-compat.ts`
- Modify: `tests/openapi-compat.test.ts`

**Verification:**

```sh
pnpm --filter @specter/specter-code test -- src/features/specter-code/tests/openapi-compat.test.ts
```

Expected initially: allowed known gaps listed in a snapshot. Final: no unplanned gaps.

---

### Phase 14: Hardening, performance, and developer experience

#### Task 14.1: Durable reaction queue

**Objective:** Replace in-memory scheduling for long-running agent work.

**Files:**

- Create/modify: `apps/specter-code/src/db/reaction-queue.ts`
- Modify: `server-runtime.server.ts`
- Test: `tests/reaction-queue.test.ts`

**Verification:**

```sh
pnpm --filter @specter/specter-code test -- src/features/specter-code/tests/reaction-queue.test.ts
```

#### Task 14.2: Output/artifact truncation

**Objective:** Keep huge tool outputs usable.

**Files:**

- Create: `adapters/artifacts.ts`
- Modify: `tools/*`
- Test: `tests/artifacts.test.ts`

**Verification:**

```sh
pnpm --filter @specter/specter-code test -- src/features/specter-code/tests/artifacts.test.ts
```

#### Task 14.3: Full smoke suite

**Objective:** Prove end-to-end local coding workflow.

**Files:**

- Create: `tests/e2e/full-coding-flow.spec.ts`

**Scenario:**

1. Open temp workspace.
2. Create session.
3. Submit prompt: "add a passing test and run it".
4. Fake or sandboxed runtime proposes file edit.
5. Approval is requested.
6. User approves.
7. Shell command streams output.
8. Transcript shows success.
9. Diff panel shows changed file.
10. Revert restores snapshot.

**Verification:**

```sh
pnpm --filter @specter/specter-code test:e2e -- full-coding-flow.spec.ts
```

---

## Milestones

### Milestone A: Specter Code MVP

- New app exists and passes typecheck/test/build.
- Session create/list/transcript works.
- Fake runtime streams assistant/tool events.
- Web UI shows sessions, transcript, timeline.
- Basic read/search/write/shell tools exist behind approvals.

### Milestone B: Real local coding assistant

- Real AI SDK provider streaming.
- File edits, shell, git diff/status, snapshots, revert.
- SSE/WebSocket live updates.
- Permission UI and pending approvals.
- End-to-end coding-flow Playwright test.

### Milestone C: OpenCode parity beta

- CLI `run`, `serve`, session commands.
- Config/provider/agent/plugin compatibility.
- LSP, MCP, PTY, task/subagent, web tools.
- OpenAPI route parity for common endpoints.
- Import/export session support.

### Milestone D: Complete clone

- TUI parity for daily use.
- Route parity checklist closed or intentionally documented.
- Performance hardening for large transcripts and outputs.
- Durable reaction queue and resumable long-running work.
- Full regression suite green.

---

## Files Likely to Change

New primary app:

```txt
apps/specter-code/**
```

Root workspace scripts:

```txt
package.json
pnpm-lock.yaml
```

Possible docs:

```txt
README.md
docs/specter-code.md
docs/opencode-compatibility.md
```

Avoid changing unless a general runtime need is proven:

```txt
packages/core/**
```

---

## Validation Matrix

Run frequently during implementation:

```sh
cd /home/lucifer/work/active/specter
pnpm --filter @specter/specter-code typecheck
pnpm --filter @specter/specter-code test
pnpm --filter @specter/specter-code build
```

Before milestone completion:

```sh
pnpm build
pnpm typecheck
pnpm test
pnpm --filter @specter/specter-code test:e2e
```

Manual smoke for MVP:

```sh
pnpm dev:specter-code
# In browser:
# - create workspace/session
# - send prompt
# - observe streamed fake/real response
# - approve a tool call
# - inspect file tree/diff/timeline
```

Manual CLI smoke after Phase 12:

```sh
node apps/specter-code/dist/cli/index.js --help
node apps/specter-code/dist/cli/index.js run --format json "summarize this project"
node apps/specter-code/dist/cli/index.js serve --port 41734
```

---

## Risks and Mitigations

1. **Scope explosion from cloning all of OpenCode.**
   - Mitigation: implement route/tool parity in milestones; keep an explicit compatibility checklist.
2. **Specter slice state becoming too large for transcripts/tool outputs.**
   - Mitigation: keep events authoritative, but project large read models/artifacts into dedicated SQLite tables/files.
3. **Long-running reaction work lost on process restart.**
   - Mitigation: add durable reaction queue before beta.
4. **Unsafe shell/file operations.**
   - Mitigation: approval-first permissions, path containment, snapshots before mutation, output limits, symlink policy.
5. **TUI complexity delaying useful product.**
   - Mitigation: build web + non-interactive CLI first; add TUI after API/event stream stabilizes.
6. **Provider/config compatibility ambiguity.**
   - Mitigation: import OpenCode fixtures and test them; intentionally document unsupported keys until implemented.
7. **Mixing app-specific code into `@specter-ts/core`.**
   - Mitigation: keep LLM/tool/PTY/config/plugins in `apps/specter-code/src/features/specter-code/adapters`.

---

## Open Questions

1. Product name: should the app be `apps/specter-code`, `apps/opencode-reference`, or another name?
2. Should initial UI be web-first, CLI-first, or TUI-first? The plan recommends web + API + non-interactive CLI before full TUI.
3. Should compatibility target OpenCode's current main branch exactly, or a pinned release/tag?
4. Should Specter Code import existing OpenCode session DBs, or only support JSON import/export initially?
5. Which providers must work on day one: OpenRouter, Anthropic, OpenAI, local OpenAI-compatible, Gemini, Copilot?
6. Should real shell/tool execution run directly on host, inside a sandbox, or through an external worker process?

---

## Recommended Next Step

Start with Phase 1 through Milestone A using subagents:

1. One subagent copies/renames Threadplane into `apps/specter-code` and gets typecheck/build passing.
2. One subagent designs and implements the session/message event vocabulary plus core slices with scenario tests.
3. One subagent builds the fake agent runtime + timeline UI bridge.
4. Parent agent verifies every subagent claim with `pnpm --filter @specter/specter-code typecheck`, `test`, and `build` before moving to real tool execution.
