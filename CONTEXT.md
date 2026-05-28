# Specter

Specter is a TypeScript and Solid framework for vertically sliced event-sourced applications. Example applications exist to prove the framework API and clarify usage; they are not the product itself.

## Language

**Specter**:
A TypeScript and Solid framework for vertically sliced event-sourced applications.
_Avoid_: Todo app

**Specter Framework Package**:
The installable public distribution of Specter, published as `@specter-ts/core`, that a generated Specter Project depends on for framework and runtime APIs. A Specter Framework Package is distinct from the Project Initializer.
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
An executable application used to prove Specter's canonical framework API and demonstrate intended usage. A Reference application should not lag behind the intended Specter API.
_Avoid_: Product app, primary app

**Product Site**:
The public-facing site for presenting Specter itself and collecting interest from prospective users. A Product Site is distinct from a Reference application, even when it dogfoods Specter concepts.
_Avoid_: Reference application, todo app

**Waitlist Signup**:
A unique email registration from a prospective Specter user on the Product Site, including the Product Site variation that originated it. A Waitlist Signup is not a repeated interest signal; duplicate email registration is rejected.
_Avoid_: Lead event, repeated signup

**Specter App**:
The runtime composition of Event definitions and Slices for a user-defined application scope. A Specter App owns one Event Log, dispatches commands, answers queries, and runs reactions.
_Avoid_: Registry

**Specter Client**:
The app-inferred client shape exposed to views and runtime adapters. It exposes top-level methods named exactly after Command Slice and Query Slice names; TypeScript return types distinguish command methods from query methods. The concrete Effect RPC adapter is still pending, so the current reference app implements this shape over the Hono HTTP boundary.
_Avoid_: Stringly-typed dispatch client

**Slice**:
A named specification unit in a vertical feature that participates in event-log catch-up and slice state. A slice has one kind: Command Slice, Query Slice, or Reaction Slice; slice names are unique within a Specter App and become Specter Client method names, every Slice declares Event interests with Event definitions, and relevant Events are applied in global Event Log order.
_Avoid_: Full feature, persistence shard, view

**Slice State**:
The private event-derived state a Slice uses after catch-up. Command Slice state supports decisions, Query Slice state supports queries, and Reaction Slice state supports whether to produce a Reaction Effect; two Slices should not share Slice State.
_Avoid_: Shared app state

**Slice Cursor**:
The per-slice record of the last Event Log order applied to that Slice's Slice State. A Slice Cursor advances after successful event application, consistently across Slice kinds.
_Avoid_: App-wide checkpoint

**View**:
An executable UI contract that composes Query Slices and Command Slices through typed references and local query and trigger aliases. In the current Solid runtime, queries are auto-run by the view runtime and their resolved data is passed to the component, while command triggers are passed as functions that return Effects for the component to run. Components choose when to run trigger Effects and how to represent pending or failed trigger work. A View is a sibling of Slice, not a kind of Slice, and Views are not validated as members of a Specter App.
_Avoid_: Slice, route

**Command Slice**:
A slice that defines exactly one command and decides which events should be emitted when that command is accepted. The Command Slice name is the command type clients dispatch, and the slice may maintain event-derived decision state before handling the command. Command catch-up, read-only decision handling, and event append happen in one transaction; Events emitted by one accepted command append atomically and in order, then self-emitted Events are applied later through normal catch-up.
_Avoid_: Stateless command handler, query reader

**Reaction Slice**:
A slice that asynchronously observes new events after command success and may produce zero or one Reaction Effect per catch-up cycle. Reaction catch-up and read-only handling happen in one transaction; executing the resulting Reaction Effect happens afterward in a separate transaction or effect boundary. Reaction Slice failures do not prevent unrelated Reaction Slices from running in the same reaction run.
_Avoid_: Batch effect emitter

**Reaction Effect**:
The ephemeral output of a Reaction Slice. By default, a Reaction Effect is interpreted as a command dispatch; a per-slice reaction plugin can interpret other effect payloads. Reaction Effects are not automatically retried.
_Avoid_: Reaction command

**Reaction Run Failure**:
An aggregate failure reported after a reaction run processes all unrelated Reaction Slices it can. It includes the failed Reaction Slice names and causes.
_Avoid_: First failure only

**Query Slice**:
A slice that owns an event-derived read model and answers one query at its slice name. Query catch-up and read-only execution happen in one transaction; Query Slices serve reads and Views, not Command Slice decisions.
_Avoid_: Shared command state, stateless query handler

**Event**:
A domain fact emitted by an accepted command or reaction. The Specter App assigns Event IDs when appending Events to the Event Log.
_Avoid_: Error response, validation failure

**Event Definition**:
A named schema and factory for Events. Event Definitions are owned by Vertical Features and registered with a Specter App; event type names are unique within a Specter App's Event Log, and persisted event payloads are decoded against their Event Definitions before being applied to Slices.
_Avoid_: Event instance

**Event Draft**:
A typed event value created by an Event Definition before it is appended to the Event Log. Command Slices emit Event Drafts; the Specter App appends them and returns persisted Events with log metadata.
_Avoid_: Persisted event

**Event Log**:
The ordered durable record of registered Events owned by a Specter App. In runtime use, Events enter the Event Log through accepted commands; the Event Log assigns persistence metadata such as ID, order, and recorded timestamp. The Event Log can contain as many event types as the application needs, but should not accept unknown event types.
_Avoid_: Per-feature log

**Rejected Command**:
A command that is not accepted and does not emit events. A rejected command returns a standard failure envelope with a domain-defined reason instead of appending to the event log.
_Avoid_: Error event

**Invalid Command Input**:
A command payload that cannot be decoded against the command schema. Invalid command input is different from a Rejected Command, whose payload decoded successfully.
_Avoid_: Rejected command

**Invalid Query Input**:
A query input that cannot be decoded against the Query Slice schema. Invalid query input should fail the query rather than silently becoming an empty or default result.
_Avoid_: Empty query result

**Scenario**:
An executable example attached to a Slice. Scenarios are usually shaped as given Event Drafts, when input or action, and expected outcome. Given and expected Event Drafts must match registered Event Definitions; given Event Drafts are test setup, not runtime ingestion; in Command Slice scenarios, expecting no events means the command must fail as a Rejected Command.
_Avoid_: View scenario, test-only case, documentation-only example

**Vertical Feature**:
A user-facing capability grouped around domain behavior and composed from nearby Slices, Views, and Event definitions. A vertical feature is a comprehension boundary, not necessarily a runtime boundary.
_Avoid_: Runtime module, route
