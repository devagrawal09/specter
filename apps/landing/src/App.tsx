import { createSignal, For, type JSX } from 'solid-js'
import { CodeBlock } from './CodeBlock'
import {
  adapters,
  agentBenefits,
  behaviorTestOutput,
  eventLog,
  externalApiSource,
  pipeline,
  reactionSource,
  sliceTree,
  specSource,
} from './content'

const INSTALL_COMMAND = 'npm create specter'

function CommandLine(): JSX.Element {
  const [copied, setCopied] = createSignal(false)

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(INSTALL_COMMAND)
      setCopied(true)
      setTimeout(() => setCopied(false), 1600)
    } catch {
      setCopied(false)
    }
  }

  return (
    <div class="command">
      <code class="command__text">
        <span class="command__prompt" aria-hidden="true">
          $
        </span>{' '}
        {INSTALL_COMMAND}
      </code>
      <button type="button" class="command__copy" onClick={copy}>
        {copied() ? 'copied' : 'copy'}
      </button>
    </div>
  )
}

export function App(): JSX.Element {
  return (
    <div class="page">
      <header class="topbar">
        <a class="brand" href="#top">
          <span class="brand__mark" aria-hidden="true">
            ▮
          </span>
          <span class="brand__name">Specter</span>
          <span class="brand__tag">Compiler Console</span>
        </a>
        <nav class="topnav" aria-label="Pipeline">
          <For each={pipeline}>
            {(stage) => (
              <a class="topnav__link" href={`#${stage.id}`}>
                {stage.title}
              </a>
            )}
          </For>
        </nav>
        <a class="topbar__cta" href="#start">
          Get started
        </a>
      </header>

      <main id="top">
        <section class="hero">
          <p class="eyebrow">
            TypeScript runtime · event-sourced · vertically sliced
          </p>
          <h1 class="hero__title">
            specifications that compile execute and scaffold your app
          </h1>
          <p class="hero__lede">
            Specter is a TypeScript runtime for building apps as small, vertical
            specifications. You describe a command, the events it emits, and the
            scenarios it must satisfy. Specter compiles that spec into behavior
            tests, scaffolds the slice, records every fact to a durable event
            log, and draws the architecture back out for you.
          </p>
          <div class="hero__actions">
            <CommandLine />
            <a class="btn btn--ghost" href="#pipeline">
              See the pipeline
            </a>
          </div>

          <div class="hero__pipeline" aria-hidden="true">
            <For each={pipeline}>
              {(stage, i) => (
                <>
                  <span class="chip">
                    <b>{stage.step}</b>
                    {stage.title}
                  </span>
                  {i() < pipeline.length - 1 ? (
                    <span class="chip__arrow">→</span>
                  ) : null}
                </>
              )}
            </For>
          </div>
        </section>

        <section class="band" id="how">
          <div class="band__head">
            <h2>How it works</h2>
            <p>
              One idea, applied consistently: the specification is the source.
              Everything runtime and everything visual is derived from it, so
              behavior, code, and documentation cannot drift apart.
            </p>
          </div>
          <div class="grid grid--3">
            <article class="card">
              <h3>Write a slice</h3>
              <p>
                A slice is one named unit — a command, query, or reaction — with
                its event interests and scenarios in a single file boundary.
              </p>
            </article>
            <article class="card">
              <h3>Compile it</h3>
              <p>
                Scenarios become behavior tests. Types flow into an inferred
                client contract. The runtime knows exactly which events each
                slice cares about.
              </p>
            </article>
            <article class="card">
              <h3>Run anywhere</h3>
              <p>
                Slices catch up on the ordered event log and answer commands and
                queries through adapters you choose — storage, protocol, and
                frontend stay pluggable.
              </p>
            </article>
          </div>
        </section>

        <section class="stage" id="pipeline">
          <div class="band__head">
            <h2>The pipeline</h2>
            <p>
              spec → behavior test → slice → event log → visual map. Each stage
              below is produced from the one before it.
            </p>
          </div>
        </section>

        <section class="stage" id="spec">
          <div class="stage__grid">
            <div class="stage__copy">
              <span class="stage__step">01 · spec</span>
              <h2>Structured specs, not prose</h2>
              <p>
                A command slice states its input schema, the events it may emit,
                and concrete scenarios shaped as <em>given / when / then</em>.
                This is the whole contract — typed, explicit, and small enough
                to hold in your head.
              </p>
              <ul class="ticks">
                <li>Events are named domain facts with a schema.</li>
                <li>
                  Scenarios use real event drafts, so examples stay honest.
                </li>
                <li>
                  An accepted command emits at least one event; emitting none is
                  a rejection.
                </li>
              </ul>
            </div>
            <CodeBlock
              label="features/waitlist/sign-up/slice.ts"
              tag="spec"
              code={specSource}
            />
          </div>
        </section>

        <section class="stage" id="behavior-test">
          <div class="stage__grid stage__grid--flip">
            <CodeBlock
              label="specter test waitlist/sign-up"
              tag="generated"
              tone="output"
              code={behaviorTestOutput}
            />
            <div class="stage__copy">
              <span class="stage__step">02 · behavior test</span>
              <h2>Specs become behavior tests, automatically</h2>
              <p>
                Every scenario compiles straight into an executable test. There
                is no separate test suite to keep in sync — the examples in the
                spec <em>are</em> the tests, and they run on every change.
              </p>
              <ul class="ticks">
                <li>
                  A scenario expecting events asserts exactly those events.
                </li>
                <li>
                  A scenario expecting none asserts the command is rejected.
                </li>
                <li>Change behavior and the intended contract fails loudly.</li>
              </ul>
            </div>
          </div>
        </section>

        <section class="stage" id="slice">
          <div class="stage__grid">
            <div class="stage__copy">
              <span class="stage__step">03 · slice</span>
              <h2>Vertical slices, built and tested independently</h2>
              <p>
                Each feature is scaffolded as a self-contained vertical: its
                events, its command, its read model, and the registry line that
                wires it in. Slices don't share state, so you can build, test,
                and reason about one without loading the rest of the app.
              </p>
              <ul class="ticks">
                <li>One slice is one comprehension boundary.</li>
                <li>
                  Slice state is private and event-derived — no shared app
                  store.
                </li>
                <li>Add a feature by adding a folder, not by editing a hub.</li>
              </ul>
            </div>
            <CodeBlock
              label="scaffolded structure"
              tag="slice"
              tone="output"
              code={sliceTree}
            />
          </div>
        </section>

        <section class="stage" id="event-log">
          <div class="stage__grid stage__grid--flip">
            <CodeBlock
              label="app event log"
              tag="durable"
              tone="output"
              code={eventLog}
            />
            <div class="stage__copy">
              <span class="stage__step">04 · event log</span>
              <h2>It never loses data, by design</h2>
              <p>
                State is not the source of truth — the event log is. Accepted
                commands append immutable facts to one ordered, append-only log.
                Read models are projections you can rebuild by replaying events,
                so a schema change or a new view never means lost history.
              </p>
              <ul class="ticks">
                <li>
                  Append-only and ordered: facts are added, never overwritten.
                </li>
                <li>
                  Durable by adapter — SQLite, Postgres, or in-memory for tests.
                </li>
                <li>Rebuild any read model by replaying the log.</li>
              </ul>
            </div>
          </div>
        </section>

        <section class="stage" id="orchestration">
          <div class="stage__grid">
            <div class="stage__copy">
              <span class="stage__step">flow · reactions</span>
              <h2>Slices are orchestrated through events</h2>
              <p>
                Slices don't call each other. A command appends events; reaction
                slices observe those committed events and produce a single
                explicit effect — which may dispatch another command.
                Coordination is data flowing through the log, not a tangle of
                direct calls.
              </p>
              <div class="flow" aria-hidden="true">
                <span class="flow__node">command</span>
                <span class="flow__edge">emits →</span>
                <span class="flow__node flow__node--event">event</span>
                <span class="flow__edge">observed by →</span>
                <span class="flow__node">reaction</span>
                <span class="flow__edge">effect →</span>
                <span class="flow__node flow__node--muted">command</span>
              </div>
            </div>
            <CodeBlock
              label="features/notify/send-welcome/slice.ts"
              tag="reaction"
              code={reactionSource}
            />
          </div>
        </section>

        <section class="band" id="anywhere">
          <div class="band__head">
            <h2>Runs anywhere, opinionated about nothing</h2>
            <p>
              Specter has no opinion about your database, your protocol, or your
              frontend. Slices and scenarios depend only on the runtime
              contract; the concrete boundaries are adapters you swap without
              touching a single spec.
            </p>
          </div>
          <div class="grid grid--4">
            <For each={adapters}>
              {(adapter) => (
                <article class="card card--slot">
                  <h3>{adapter.slot}</h3>
                  <p>{adapter.detail}</p>
                  <p class="card__swap">{adapter.swap}</p>
                </article>
              )}
            </For>
          </div>
        </section>

        <section class="stage" id="external">
          <div class="stage__grid stage__grid--flip">
            <CodeBlock
              label="features/notify/plugins/email.ts"
              tag="plugin"
              code={externalApiSource}
            />
            <div class="stage__copy">
              <span class="stage__step">integration · plugins</span>
              <h2>Connect any external API</h2>
              <p>
                A reaction's effect is interpreted by an explicit plugin.
                Reaching Stripe, an email provider, or another Specter app is
                just choosing a plugin — the slice and its scenarios never
                change, and integrations stay isolated and testable.
              </p>
              <ul class="ticks">
                <li>Effects are declared; plugins interpret them.</li>
                <li>Swap providers without rewriting behavior.</li>
                <li>Same-app and cross-app dispatch are both just plugins.</li>
              </ul>
            </div>
          </div>
        </section>

        <section class="band" id="agents">
          <div class="band__head">
            <h2>Built for coding agents</h2>
            <p>
              The same structure that keeps humans oriented makes agents faster
              and safer. Small boundaries mean less context per task; executable
              scenarios mean strong guardrails on every edit.
            </p>
          </div>
          <div class="grid grid--2">
            <For each={agentBenefits}>
              {(benefit) => (
                <article class="card">
                  <h3>{benefit.title}</h3>
                  <p>{benefit.body}</p>
                </article>
              )}
            </For>
          </div>
        </section>

        <section class="stage" id="visual-map">
          <div class="band__head">
            <h2>Architecture, drawn from your specs</h2>
            <p>
              Because specs, slices, and events are structured data, Specter can
              render them into a live map of your system — the slices you have,
              the events they share, and how data flows between them. The
              diagram is generated, so it can't fall out of date.
            </p>
          </div>
          <figure class="map">
            <figcaption class="map__cap">
              waitlist + notify · generated dataflow
            </figcaption>
            <pre class="map__art">{MAP_ART}</pre>
          </figure>
        </section>

        <section class="cta" id="start">
          <h2>Start with one spec</h2>
          <p>
            Scaffold a Specter project with a reference app, an event log, and a
            first vertical slice ready to compile.
          </p>
          <CommandLine />
          <p class="cta__note">
            Requires Node and your package manager of choice. No account, no
            keys.
          </p>
        </section>
      </main>

      <footer class="foot">
        <span>
          Specter · a TypeScript runtime for vertically sliced, event-sourced
          apps.
        </span>
        <span class="foot__mark">
          spec → behavior test → slice → event log → visual map
        </span>
      </footer>
    </div>
  )
}

const MAP_ART = `        ┌───────────────────────── Specter App ─────────────────────────┐
        │                                                                │
        │   [ signUp ]  ──emits──▶  ( WaitlistSignedUp )                 │
        │   command slice                 │                              │
        │                                 ├──▶  [ signupsQuery ]  read   │
        │                                 │                              │
        │                                 └──▶  [ sendWelcome ]  react   │
        │                                              │                 │
        │                                              ▼                 │
        │                                        email plugin ──▶ API    │
        │                                                                │
        │   ═══════════════════  ordered event log  ═══════════════════ │
        └────────────────────────────────────────────────────────────────┘`
