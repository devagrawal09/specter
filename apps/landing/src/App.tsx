import { createSignal, For, type JSX } from 'solid-js'
import { ArchitectureMap } from './ArchitectureMap'
import { CodeBlock } from './CodeBlock'
import { kindColor, kindLabel, nodes, snippets } from './architecture'

const legend: { kind: keyof typeof kindColor; label: string }[] = [
  { kind: 'spec', label: 'Specification' },
  { kind: 'slice', label: 'Slice' },
  { kind: 'event', label: 'Event' },
  { kind: 'log', label: 'Event log' },
  { kind: 'client', label: 'Client / UI' },
]

const pillars = [
  {
    step: '01',
    title: 'Specify',
    body: 'Describe each vertical feature as typed events and slices with plain-language scenarios. The specification is the source of truth.',
  },
  {
    step: '02',
    title: 'Compile & execute',
    body: 'Specter compiles those declarations into runnable command, query, and reaction slices wired to a durable event log.',
  },
  {
    step: '03',
    title: 'Test, scaffold & visualize',
    body: 'The same declarations generate behavior tests, scaffold new features, and render the architecture map you are reading.',
  },
]

const capabilities = [
  {
    kind: 'log' as const,
    title: 'Runs anywhere, no opinions',
    body: 'Specter core owns runtime contracts, not infrastructure. Bring your own database, protocol, and frontend — SQLite and a typed client are just the reference adapters.',
  },
  {
    kind: 'event' as const,
    title: 'Connect any external API',
    body: 'Reaction slices call outward through small plugin adapters, so an event can trigger email, payments, or any third-party API without leaking into your domain.',
  },
  {
    kind: 'slice' as const,
    title: 'Built for AI agents',
    body: 'Each slice is a small, isolated unit with a schema, scenarios, and a single handler. Agents load one slice of context and stay inside strong, testable guardrails.',
  },
  {
    kind: 'spec' as const,
    title: 'Architecture from source',
    body: 'Because specs, slices, and events are structured data, Specter can translate them into diagrams of architecture and dataflow — like the map above.',
  },
]

export function App(): JSX.Element {
  const [active, setActive] = createSignal('spec')
  const [copied, setCopied] = createSignal(false)

  const activeNode = () => nodes.find((node) => node.id === active())
  const activeSnippet = () => snippets[active()] ?? snippets.spec

  const copyCommand = async () => {
    try {
      await navigator.clipboard.writeText('npm create specter')
      setCopied(true)
      setTimeout(() => setCopied(false), 1600)
    } catch {
      setCopied(false)
    }
  }

  return (
    <div class="page">
      <header class="site-header">
        <a class="brand" href="#top">
          <span class="brand-mark" aria-hidden="true" />
          <span class="brand-name">Specter</span>
        </a>
        <nav class="site-nav" aria-label="Primary">
          <a href="#how">How it works</a>
          <a href="#specs">Specs</a>
          <a href="#durable">Event log</a>
          <a href="#start" class="nav-cta">
            Get started
          </a>
        </nav>
      </header>

      <main id="top">
        <section class="hero">
          <p class="eyebrow">Specification-first application framework</p>
          <h1 class="hero-title">
            specifications that compile execute and scaffold your app
          </h1>
          <p class="hero-sub">
            Specter turns one structured specification per feature into running
            vertical slices, a durable event log, behavior tests, and the live
            architecture map below.
          </p>

          <div class="hero-actions">
            <button
              type="button"
              class="term-pill"
              onClick={copyCommand}
              aria-label="Copy the npm create specter command"
            >
              <span class="term-prompt">$</span>
              <span class="term-cmd">npm create specter</span>
              <span class="term-copy">{copied() ? 'copied' : 'copy'}</span>
            </button>
            <a class="ghost-link" href="#how">
              See how it works
            </a>
          </div>

          <ul class="legend" aria-label="Node types in the architecture map">
            <For each={legend}>
              {(item) => (
                <li>
                  <span
                    class="legend-dot"
                    style={{ background: kindColor[item.kind] }}
                  />
                  {item.label}
                </li>
              )}
            </For>
          </ul>
        </section>

        <section
          class="map-section"
          aria-label="Generated architecture and dataflow map"
        >
          <div class="map-shell">
            <div class="map-heading">
              <h2>Generated from your specs, slices &amp; events</h2>
              <p>
                Hover or select a node to trace the dataflow and read the
                specification that produced it.
              </p>
            </div>
            <div class="map-toolbar">
              <For each={nodes}>
                {(node) => (
                  <button
                    type="button"
                    class="trace-btn"
                    classList={{ 'is-active': active() === node.id }}
                    style={{ '--c': kindColor[node.kind] }}
                    aria-pressed={active() === node.id ? 'true' : 'false'}
                    onClick={() => setActive(node.id)}
                    onMouseEnter={() => setActive(node.id)}
                    onFocus={() => setActive(node.id)}
                  >
                    <span class="trace-dot" />
                    {node.title}
                  </button>
                )}
              </For>
            </div>
            <div class="map-grid">
              <div class="map-canvas">
                <ArchitectureMap active={active()} />
              </div>
              <aside class="map-panel" aria-live="polite">
                <div class="panel-head">
                  <span
                    class="panel-dot"
                    style={{
                      background: kindColor[activeNode()?.kind ?? 'spec'],
                    }}
                  />
                  <span class="panel-kind">
                    {kindLabel[activeNode()?.kind ?? 'spec']}
                  </span>
                  <span class="panel-title">{activeNode()?.title}</span>
                </div>
                <p class="panel-caption">{activeSnippet().caption}</p>
                <CodeBlock
                  file={activeSnippet().file}
                  lang={activeSnippet().lang}
                  code={activeSnippet().code}
                />
              </aside>
            </div>
          </div>
        </section>

        <section id="how" class="section">
          <div class="section-head">
            <h2>What Specter is, and how it works</h2>
            <p>
              Specter is a TypeScript framework for building vertically sliced,
              event-sourced applications. You write the specification once;
              Specter treats that specification as a source of truth it can
              compile, execute, test, scaffold, and visualize.
            </p>
          </div>
          <ol class="pillars">
            <For each={pillars}>
              {(pillar) => (
                <li class="pillar">
                  <span class="pillar-step">{pillar.step}</span>
                  <h3>{pillar.title}</h3>
                  <p>{pillar.body}</p>
                </li>
              )}
            </For>
          </ol>
        </section>

        <section id="specs" class="section split">
          <div class="split-copy">
            <p class="kicker">Structured specs · behavior tests</p>
            <h2>Structured specs that test themselves</h2>
            <p>
              A slice declares a schema, a handler, and scenarios written in
              plain language. Each scenario is an executable example: a{' '}
              <code>given</code> history of events, a <code>when</code> input,
              and the <code>expect</code>ed result.
            </p>
            <p>
              Specter runs every scenario as a behavior test. For a command
              slice, expecting no events means the command must be rejected — so
              your specification and your test suite never drift apart.
            </p>
          </div>
          <div class="split-visual">
            <CodeBlock
              file={snippets.cmd.file}
              lang={snippets.cmd.lang}
              code={snippets.cmd.code}
            />
          </div>
        </section>

        <section class="section">
          <div class="section-head">
            <h2>Vertical slices, built and tested independently</h2>
            <p>
              A slice is one command, query, or reaction with private,
              event-derived state. Slices never import each other, so you can
              build, scenario-test, and reason about a single slice without
              loading the rest of the app.
            </p>
          </div>
          <div class="slice-row">
            <For
              each={[
                {
                  kind: 'slice' as const,
                  tag: 'Command',
                  body: 'Validates input, decides, and emits domain events. Owns its own decision state.',
                },
                {
                  kind: 'slice' as const,
                  tag: 'Query',
                  body: 'Folds events into a private read model and answers reads. Never drives commands.',
                },
                {
                  kind: 'slice' as const,
                  tag: 'Reaction',
                  body: 'Listens to events and requests follow-up commands to orchestrate the system.',
                },
              ]}
            >
              {(slice) => (
                <article
                  class="slice-card"
                  style={{ '--c': kindColor[slice.kind] }}
                >
                  <span class="slice-tag">{slice.tag} slice</span>
                  <p>{slice.body}</p>
                </article>
              )}
            </For>
          </div>
        </section>

        <section id="durable" class="section split reverse">
          <div class="split-copy">
            <p class="kicker">Durable events · orchestration</p>
            <h2>The app never loses data</h2>
            <p>
              Every accepted command appends immutable events to an append-only
              event log. That log is the system of record: read models and
              reactions are derived by replaying it, so nothing depends on
              mutable rows that can be overwritten or lost.
            </p>
            <p>
              Specter orchestrates slices through those same events. A reaction
              slice observes new events and requests follow-up commands, keeping
              multi-step workflows explicit, replayable, and testable.
            </p>
          </div>
          <div class="split-visual">
            <CodeBlock
              file={snippets.log.file}
              lang={snippets.log.lang}
              code={snippets.log.code}
            />
          </div>
        </section>

        <section class="section">
          <div class="section-head">
            <h2>One source of truth, many outputs</h2>
            <p>
              Because the specification is structured data, Specter can target
              your infrastructure, your integrations, your agents, and your
              diagrams — all from the same declarations.
            </p>
          </div>
          <div class="cap-grid">
            <For each={capabilities}>
              {(cap) => (
                <article
                  class="cap-card"
                  style={{ '--c': kindColor[cap.kind] }}
                >
                  <span class="cap-dot" />
                  <h3>{cap.title}</h3>
                  <p>{cap.body}</p>
                </article>
              )}
            </For>
          </div>
        </section>

        <section id="start" class="section start">
          <div class="start-inner">
            <p class="kicker">Getting started</p>
            <h2>Scaffold a Specter app in one command</h2>
            <p class="start-sub">
              Generate a fully specified reference feature — events, slices,
              scenarios, and wiring — then start editing the specification.
            </p>
            <button
              type="button"
              class="term-block"
              onClick={copyCommand}
              aria-label="Copy the npm create specter command"
            >
              <span class="term-line">
                <span class="term-prompt">$</span>
                <span class="term-cmd">npm create specter</span>
              </span>
              <span class="term-copy-lg">{copied() ? 'Copied' : 'Copy'}</span>
            </button>
            <ol class="start-steps">
              <li>Scaffold the project and install dependencies.</li>
              <li>
                Open <code>src/features/todos</code> — the worked example — and
                read its events, slices, and scenarios.
              </li>
              <li>
                Change a spec, run the scenarios, and watch the architecture map
                update with it.
              </li>
            </ol>
          </div>
        </section>
      </main>

      <footer class="site-footer">
        <span class="brand-mark small" aria-hidden="true" />
        <p>
          Specter — specification-first, event-sourced TypeScript. Copy is
          illustrative; no real credentials are used on this page.
        </p>
      </footer>
    </div>
  )
}
