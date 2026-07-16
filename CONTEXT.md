# Specter

Specter is a Promise-based TypeScript runtime for vertically sliced event-sourced applications. It exposes typed Command, Query, and subscription envelopes while generated projects own their transport. Example applications prove the framework API and clarify usage; they are not the product itself.

## Language

**Specter**:
A Promise-based TypeScript runtime for vertically sliced event-sourced applications with typed envelope dispatch.
_Avoid_: Todo app

**Specter Framework Package**:
The installable public distribution of Specter, published as `@specter-ts/core`, that a generated Specter Project depends on for storage-agnostic framework and runtime APIs. A Specter Framework Package is distinct from the Project Initializer and from concrete storage adapters.
_Avoid_: Starter template, copied framework source

**Project Initializer**:
The tool a user runs to create a new Specter Project from a Starter Template, published as `create-specter` and invoked canonically with `npm create specter@latest`. A Project Initializer is not a runtime dependency of the generated project.
_Avoid_: Framework package, runtime

**Specter Project**:
A user-owned application created to build with Specter. A Specter Project depends on the Specter Framework Package and may begin from a Starter Template.
_Avoid_: Specter framework, reference application

**Starter Template**:
The template copied by the Project Initializer to create a new Specter Project. The Starter Template should demonstrate Specter through a Reference application without including Product Site or Waitlist Signup concerns.
_Avoid_: Product Site, blank project

**Agent Skill**:
Instructional material included with a Specter Project to teach coding agents how to work with Specter's domain model, file boundaries, and development workflows. An Agent Skill is guidance for collaborators, not runtime application code.
_Avoid_: Framework API, generated app feature

**Reference application**:
An executable application used to prove Specter's canonical framework API and demonstrate intended usage. Multiple Reference applications may coexist to exercise different Specter capabilities; a Reference application should not lag behind the intended Specter API and is not automatically the Starter Template.
_Avoid_: Product app, primary app

**Threadplane Reference app**:
The canonical Reference application that models collaborative Workspaces with messages, agents, participants, workspace files, and Agent Runs. The app name is Threadplane Reference app, not Threadplace.
_Avoid_: Threadplace, primary product

**Workspace**:
In the Threadplane Reference app, a conversation and work surface that owns messages, agents, participants, workspace files, and Agent Runs. Multiple Workspaces may coexist, but a Workspace is not a container for separate channels or workstreams; those concepts should not exist independently in this app.
_Avoid_: Channel, Workstream, Project

**Agent Run**:
A durable domain concept for a single agent execution requested by a Workspace, user, or system event and observed through lifecycle facts. The current lifecycle fact vocabulary is run requested, run started, run streamed, run completed, run failed, tool call started, tool call completed, and tool call failed.
_Avoid_: Agent job, transient plugin invocation

**Product Site**:
The public-facing site for presenting Specter itself and collecting interest from prospective users. A Product Site is distinct from a Reference application, even when it dogfoods Specter concepts.
_Avoid_: Reference application, todo app

**Waitlist Signup**:
A unique email registration from a prospective Specter user on the Product Site, including the Product Site variation that originated it. A Waitlist Signup is not a repeated interest signal; duplicate email registration is rejected.
_Avoid_: Lead event, repeated signup

**Specter App**:
The runtime composition of Event Definitions and one selected implementation of each Slice Specification for a user-defined application scope. Specter App construction is asynchronous and validates specification/implementation conformance without executing handlers, stores, or plugins. A Specter App owns exactly one Event Log, exposes typed `command`, `query`, and `subscribe` envelope operations, and runs Reactions. Separate Specter Apps do not share Event Logs and communicate only through Commands and side effects.
_Avoid_: Registry, shared event log

**Project Transport**:
Application-owned HTTP, SSE, WebSocket, or other wiring that carries typed Specter envelopes across a process boundary. Core is transport-agnostic. The generated starter includes a canonical JSON HTTP/SSE transport that allowlists registered operations and maps structured errors. In-process applications call the Specter App directly.
_Avoid_: Specter Client, core transport

**Command Execution**:
The result returned after an accepted Command's Events commit. It proves durable Command acceptance and contains a `reactions` Promise that separately represents aggregate Reaction completion or failure. An idempotent duplicate returns the original commit with `duplicate: true`; its Reaction Promise requests or joins a fresh catch-up drain, including after a prior settled failure or process restart.
_Avoid_: Reaction result, uncommitted command

**Query Subscription**:
A typed latest-state stream for one Query envelope. It emits current state, fans out independently to every subscriber, coalesces intermediate values for a slow consumer, retains the newest value, supports `undefined`, and owns explicit activation, cancellation, and cleanup boundaries.
_Avoid_: Event stream, guaranteed history of every intermediate projection

**Slice**:
A lower-camel-case named specification and selected implementation in a vertical feature that participates in Event Log catch-up and Slice State. A Slice has one kind: Command Slice, Query Slice, or Reaction Slice; Slice names are unique within a Specter App, become typed envelope discriminants, and relevant Events are applied in global Event Log order.
_Avoid_: Full feature, persistence shard

**Slice Specification**:
The immutable "what" of a Slice: name, human-readable description, and one or more Scenarios, conventionally exported as `<sliceName>Spec` from the Slice's `spec.ts`. Specifications use branded Scenario Events by string type and do not import Event Definitions, schemas, stores, plugins, server modules, or sibling Slices. One Slice Specification may have multiple divergent implementations, each tested independently.
_Avoid_: Runtime registration, schema-bearing Slice

**Slice Implementation**:
The executable "how" of a Slice, conventionally exported as `<sliceName>` from `impl.ts`. It completes one imported Slice Specification with input and output schema stages, a Reaction Plugin when applicable, a Slice Store, zero or more typed apply handlers bound to app Event Definitions, and a terminal handler. A Specter App selects exactly one completed implementation for each Slice name; incomplete specifications cannot be registered.
_Avoid_: Specification, shared feature service

**Slice State**:
The private event-derived state a Slice uses after catch-up. Command Slice state supports decisions, Query Slice state supports queries, and Reaction Slice state supports whether to produce a Reaction Effect; two Slices should not share Slice State. Slice State is accessed through per-slice adapter-provided parameters: event application receives write-capable state, while command, query, and reaction handling receive read-only state.
_Avoid_: Shared app state

**Slice Cursor**:
The per-slice record of the last Event Log order applied to that Slice's Slice State. A Slice Cursor advances after successful event application, consistently across Slice kinds, through the same runtime-provided store that owns the Slice State.
_Avoid_: App-wide checkpoint

**Command Slice**:
A Slice that defines exactly one Command and decides which Events should be emitted when that Command is accepted. An accepted Command emits at least one Event whose type appears in an accepted Scenario outcome; any other emitted Event type is rejected at runtime. A Command that would emit no Events is a Rejected Command. Command handlers are deterministic: domain IDs, timestamps, and randomness enter through Command input or prior Events rather than being generated inside the handler. The Command call resolves after durable commit and returns a Command Execution whose nested Reaction Promise reports subsequent Reaction completion.
_Avoid_: Stateless command handler, query reader

**Reaction Slice**:
A Slice that asynchronously observes new Events after Command commit and may produce zero or one Reaction Effect per catch-up cycle. Every Reaction Slice declares an explicit Reaction Plugin. Catch-up uses staged or idempotent Slice State; the cursor publishes only after the Plugin succeeds, so a failed delivery can retry with the same logical context. Reaction Slice failures do not prevent unrelated Reaction Slices from running in the same Reaction Run.
_Avoid_: Batch effect emitter

**Reaction Effect**:
The ephemeral output of a Reaction Slice, interpreted by that slice's explicit Reaction Plugin. Reaction Effects are not automatically retried.
_Avoid_: Reaction command

**Reaction Plugin**:
The explicit interpreter for a Reaction Slice's Reaction Effect, selected when the Reaction Slice is defined. Same-app command dispatch and cross-app command dispatch are both modeled as explicit Reaction Plugins.
_Avoid_: Hidden default reaction behavior, app registry import

**Reaction Run**:
A runtime pass where a Specter App lets registered Reaction Slices catch up to new Events and execute any resulting Reaction Effects. A Reaction Run may request another Reaction Run when a Reaction Effect dispatches a command that appends more Events.
_Avoid_: Reaction queue, background job

**Reaction Scheduler**:
The app-level collaborator that owns pending and active Reaction Run state and decides when requested Reaction Runs execute. An immediate scheduler tracks run requests but not durable effects; a durable outbox scheduler persists attempts, retries, and dead letters.
_Avoid_: Reaction Queue, effect queue

**Reaction Delivery**:
One at-least-once execution of a Reaction Effect. Its `deliveryId` and ISO `scheduledAt` remain stable across retries; its `attemptId` and `attemptNumber` identify a specific try. Plugins use the delivery ID for downstream idempotency and the scheduled time for retry-stable domain timestamps.
_Avoid_: Exactly-once side effect

**Reaction Run Failure**:
An aggregate failure reported by `CommandExecution.reactions` after a Reaction Run processes all unrelated Reaction Slices and Reaction Effects it can. It includes the failed Reaction Slice names and causes without changing the already committed Command outcome.
_Avoid_: First failure only

**Query Slice**:
A slice that owns an event-derived read model and answers one query at its slice name. Query catch-up publishes Slice State and cursor atomically or uses idempotent apply handlers before read-only execution; Query Slices serve reads and Views, not Command Slice decisions.
_Avoid_: Shared command state, stateless query handler

**Event**:
A domain fact emitted by an accepted Command. A Reaction may dispatch another Command, and that Command may emit Events through its normal guarded boundary; a Reaction Effect is not itself an Event. The Specter App assigns Event IDs when appending Events to the Event Log.
_Avoid_: Error response, validation failure

**Event Definition**:
A kebab-case type, runtime schema, and factory for Events. Event Definitions are implementation contracts owned by Vertical Features and registered once with a Specter App. Event schemas validate payloads but must preserve them one-to-one: they cannot strip, transform, or generate payload fields.
_Avoid_: Event instance

**Event Draft**:
A typed event value created by an Event Definition before it is appended to the Event Log. Command Slices emit Event Drafts; the Specter App appends them and returns persisted Events with log metadata.
_Avoid_: Persisted event

**Scenario Event**:
A branded specification example created with `event(type, payload)`. A Scenario Event contains an Event type string and exact example payload but is deliberately not an Event Draft and cannot enter runtime APIs. It lets specifications describe domain facts without importing implementation-owned Event Definitions or schemas.
_Avoid_: Event Draft, persisted Event

**Event Log**:
The ordered durable record of registered Events owned by a Specter App and accessed through one app-level adapter that atomically queries and commits Events. In runtime use, Events enter the Event Log through accepted commands; the Event Log assigns persistence metadata such as ID, order, and recorded timestamp. The Event Log can contain as many event types as the application needs, but should not accept unknown event types.
_Avoid_: Per-feature log

**Rejected Command**:
A command that is not accepted and does not emit Events. A command that would produce no Events violates the accepted-command contract and is rejected rather than treated as a successful no-op. A rejected command rejects the command promise instead of appending to the Event Log.
_Avoid_: Error event

**Invalid Command Input**:
A command payload that cannot be decoded against the command schema. Invalid command input is different from a Rejected Command, whose payload decoded successfully.
_Avoid_: Rejected command

**Invalid Query Input**:
A query input that cannot be decoded against the Query Slice schema. Invalid query input should fail the query rather than silently becoming an empty or default result.
_Avoid_: Empty query result

**Slice Input Schema**:
The optional Standard Schema supplied with `.inputSchema(...)` for a Command or Query implementation. Passing a schema validates and may transform public input before the handler; calling `.inputSchema<Type>()` without a value supplies compile-time types with no runtime validation overhead. Invalid input is a runtime boundary failure and is not modeled as a Scenario outcome.
_Avoid_: Scenario validator, Event schema

**Slice Output Schema**:
The optional Standard Schema supplied with `.outputSchema(...)` for a Query or Reaction implementation. Passing a schema validates and may transform handler output before callers or Reaction Plugins observe it; calling `.outputSchema<Type>()` without a value supplies compile-time types with no runtime validation overhead.
_Avoid_: Event schema, transport serializer

**Scenario**:
A production specification example attached to a Slice Specification. Scenarios use exact Scenario Event payloads and describe accepted or rejected outcomes; there are no invalid-input Scenarios. Command Scenarios contain Given Events, command input, and expected Events; Query Scenarios contain Given Events, query input, and expected output; Reaction Scenarios contain Given Events and expected effects. Across a Slice's Scenarios, the union of Given Event types must exactly equal its implementation's apply Event types. Every Slice and every app Event Definition appears in at least one Scenario. Expecting no Events from a Command means the command must fail as a Rejected Command.
_Avoid_: Test-only case, documentation-only example

**Vertical Feature**:
A user-facing capability grouped around domain behavior and composed from nearby Slices and Event definitions. A vertical feature is a comprehension boundary, not necessarily a runtime boundary.
_Avoid_: Runtime module, route
