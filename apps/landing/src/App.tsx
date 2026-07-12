import { createSignal, For, onCleanup, type JSX } from 'solid-js'
import { ArchitectureMap } from './ArchitectureMap'
import { CodeBlock } from './CodeBlock'
import {
  kindColor,
  kindLabel,
  type NodeId,
  type NodeKind,
  nodes,
  snippets,
} from './architecture'

const createCommand = 'npm create specter@latest my-app'

const legend: { kind: NodeKind; label: string }[] = [
  { kind: 'spec', label: 'Slice specification' },
  { kind: 'implementation', label: 'Implementation' },
  { kind: 'runtime', label: 'Specter App' },
  { kind: 'event', label: 'Event definition' },
  { kind: 'log', label: 'Event log' },
  { kind: 'plugin', label: 'Reaction plugin' },
  { kind: 'client', label: 'Client / UI' },
]

const pillars = [
  {
    step: '01',
    title: 'Specify behavior',
    body: 'Give each Slice an immutable specification: a name, a description, and exact scenarios written in domain language.',
  },
  {
    step: '02',
    title: 'Complete the implementation',
    body: 'Add schemas, a private Store, apply handlers, and a terminal handler. Reaction implementations also select an explicit plugin.',
  },
  {
    step: '03',
    title: 'Validate, test & run',
    body: 'Specter validates the selected implementations at app construction, while testSliceImplementations executes every scenario.',
  },
]

const capabilities: {
  kind: NodeKind
  title: string
  body: string
}[] = [
  {
    kind: 'runtime',
    title: 'Infrastructure stays replaceable',
    body: 'Specter core defines runtime contracts, while applications choose their Event Log, Slice Store, scheduler, transport, and UI adapters.',
  },
  {
    kind: 'plugin',
    title: 'Side effects stay explicit',
    body: 'A Reaction returns a typed effect. Its selected plugin decides whether that means dispatching a command, calling an API, or doing something else.',
  },
  {
    kind: 'implementation',
    title: 'Small boundaries for agents',
    body: 'An agent can inspect one specification beside one implementation, with exact scenarios and private state instead of a cross-feature service graph.',
  },
  {
    kind: 'spec',
    title: 'Architecture you can inspect',
    body: 'Specifications, selected implementations, Event Definitions, and adapters remain explicit in the project. The map above is a conceptual view of those contracts.',
  },
]

type CopyStatus = 'idle' | 'copied' | 'failed'

export function App(): JSX.Element {
  const [active, setActive] = createSignal<NodeId>('spec')
  const [copyStatus, setCopyStatus] = createSignal<CopyStatus>('idle')
  let copyResetTimer: ReturnType<typeof setTimeout> | undefined

  const activeNode = () =>
    nodes.find((node) => node.id === active()) ?? nodes[0]
  const activeSnippet = () => snippets[active()]
  const copyLabel = () => {
    if (copyStatus() === 'copied') return 'copied'
    if (copyStatus() === 'failed') return 'retry'
    return 'copy'
  }
  const copyAnnouncement = () => {
    if (copyStatus() === 'copied') return 'Create command copied to clipboard.'
    if (copyStatus() === 'failed') {
      return 'The create command could not be copied. Select and copy it manually.'
    }
    return ''
  }

  const scheduleCopyReset = () => {
    if (copyResetTimer) clearTimeout(copyResetTimer)
    copyResetTimer = setTimeout(() => setCopyStatus('idle'), 2000)
  }

  const copyCreateCommand = async () => {
    try {
      if (!navigator.clipboard?.writeText) {
        throw new Error('Clipboard API unavailable')
      }

      await navigator.clipboard.writeText(createCommand)
      setCopyStatus('copied')
    } catch {
      setCopyStatus('failed')
    }

    scheduleCopyReset()
  }

  onCleanup(() => {
    if (copyResetTimer) clearTimeout(copyResetTimer)
  })

  return (
    <div class="page">
      <header class="site-header">
        <a class="brand" href="#top" aria-label="Specter home">
          <span class="brand-mark" aria-hidden="true" />
          <span class="brand-name">Specter</span>
        </a>
        <nav class="site-nav" aria-label="Primary">
          <a href="#how">How it works</a>
          <a href="#specs">Specifications</a>
          <a href="#durable">Event log</a>
          <a href="#start" class="nav-cta">
            Get started
          </a>
        </nav>
      </header>

      <main id="top">
        <section class="hero" aria-labelledby="hero-title">
          <p class="eyebrow">Specification-first TypeScript runtime</p>
          <h1 id="hero-title" class="hero-title">
            specifications that compile execute and scaffold your app
          </h1>
          <p class="hero-sub">
            Specter pairs immutable Slice Specifications with selected
            implementations, validates the complete app before it runs, and
            coordinates them through one ordered Event Log.
          </p>

          <div class="hero-actions">
            <button
              type="button"
              class="term-pill"
              onClick={copyCreateCommand}
              aria-label={`Copy the ${createCommand} command`}
            >
              <span class="term-prompt" aria-hidden="true">
                $
              </span>
              <span class="term-cmd">{createCommand}</span>
              <span class="term-copy" aria-hidden="true">
                {copyLabel()}
              </span>
            </button>
            <a class="ghost-link" href="#architecture">
              Explore the architecture
            </a>
          </div>
          <output class="sr-only" aria-live="polite">
            {copyAnnouncement()}
          </output>

          <ul class="legend" aria-label="Node types in the architecture map">
            <For each={legend}>
              {(item) => (
                <li>
                  <span
                    class="legend-dot"
                    style={{ background: kindColor[item.kind] }}
                    aria-hidden="true"
                  />
                  {item.label}
                </li>
              )}
            </For>
          </ul>
        </section>

        <section
          id="architecture"
          class="map-section"
          aria-labelledby="architecture-heading"
        >
          <div class="map-shell">
            <div class="map-heading">
              <p class="map-kicker">Conceptual architecture</p>
              <h2 id="architecture-heading">
                The current contracts of a Specter App
              </h2>
              <p>
                Select a node to trace its nearest dataflow and inspect a
                representative example from the current reference app.
              </p>
            </div>
            <fieldset class="map-toolbar">
              <legend class="sr-only">Select an architecture contract</legend>
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
                    <span class="trace-dot" aria-hidden="true" />
                    {node.title}
                  </button>
                )}
              </For>
            </fieldset>
            <div class="map-grid">
              <p id="map-scroll-help" class="map-scroll-hint">
                Scroll horizontally to explore the full diagram.
              </p>
              <section
                class="map-canvas"
                aria-label="Scrollable Specter architecture diagram"
                aria-describedby="map-scroll-help"
              >
                <ArchitectureMap active={active()} onSelect={setActive} />
              </section>
              <aside class="map-panel" aria-labelledby="active-contract-title">
                <div class="panel-copy">
                  <div class="panel-head">
                    <span
                      class="panel-dot"
                      style={{ background: kindColor[activeNode().kind] }}
                      aria-hidden="true"
                    />
                    <span class="panel-kind">
                      {kindLabel[activeNode().kind]}
                    </span>
                    <h3 id="active-contract-title" class="panel-title">
                      {activeNode().title}
                    </h3>
                  </div>
                  <p class="panel-caption">{activeSnippet().caption}</p>
                </div>
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
              Specter is a TypeScript runtime for vertically sliced,
              event-sourced applications. Every Slice keeps its immutable
              behavior specification separate from its executable
              implementation, and a Specter App selects exactly one completed
              implementation per Slice name.
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
            <p class="kicker">Immutable specs · executable scenarios</p>
            <h2>Behavior stays independent from infrastructure</h2>
            <p>
              A <code>spec.ts</code> file declares only the Slice name,
              description, and scenarios. It uses exact Scenario Events by type
              string without importing Event Definitions, schemas, stores, or
              sibling Slices.
            </p>
            <p>
              <code>testSliceImplementations</code> runs every selected
              implementation against those scenarios and checks configuration
              conformance. For a Command, an empty expected Event list means the
              command must reject.
            </p>
          </div>
          <div class="split-visual">
            <CodeBlock
              file={snippets.spec.file}
              lang={snippets.spec.lang}
              code={snippets.spec.code}
            />
          </div>
        </section>

        <section class="section">
          <div class="section-head">
            <h2>One specification, one selected implementation</h2>
            <p>
              Implementations complete the specification with runtime details.
              Each owns its private event-derived Slice State and imports no
              sibling Slice implementation.
            </p>
          </div>
          <div class="slice-row">
            <For
              each={[
                {
                  tag: 'Command',
                  body: 'Validates input, catches up private decision state, and either emits at least one authorized Event Draft or rejects.',
                },
                {
                  tag: 'Query',
                  body: 'Catches relevant Events into a private read model, then answers from a read-only view of that state.',
                },
                {
                  tag: 'Reaction',
                  body: 'Catches up private state and may return one typed Reaction Effect for an explicit plugin to interpret.',
                },
              ]}
            >
              {(slice) => (
                <article
                  class="slice-card"
                  style={{ '--c': kindColor.implementation }}
                >
                  <span class="slice-tag">{slice.tag} implementation</span>
                  <p>{slice.body}</p>
                </article>
              )}
            </For>
          </div>
        </section>

        <section id="durable" class="section split reverse">
          <div class="split-copy">
            <p class="kicker">Ordered Events · derived Slice State</p>
            <h2>One app-level Event Log, explicit adapters</h2>
            <p>
              Every accepted Command emits one or more validated Event Drafts.
              The Specter App appends them through its selected Event Log
              adapter, which owns the storage durability guarantee.
            </p>
            <p>
              Each Slice Store tracks private state and a cursor. Before a
              handler runs, Specter catches that Slice up with the relevant
              persisted Events in global log order.
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
            <h2>Explicit seams, inspectable wiring</h2>
            <p>
              Specter keeps domain behavior close while leaving infrastructure
              choices visible. The result is a project humans and coding agents
              can inspect one Slice at a time.
            </p>
          </div>
          <div class="cap-grid">
            <For each={capabilities}>
              {(cap) => (
                <article
                  class="cap-card"
                  style={{ '--c': kindColor[cap.kind] }}
                >
                  <span class="cap-dot" aria-hidden="true" />
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
            <h2>Create a Specter Project from the reference app</h2>
            <p class="start-sub">
              The Project Initializer copies the current Todo reference app,
              including Events, Slice specs, selected implementations, scenario
              tests, adapters, and wiring.
            </p>
            <button
              type="button"
              class="term-block"
              onClick={copyCreateCommand}
              aria-label={`Copy the ${createCommand} command`}
            >
              <span class="term-line">
                <span class="term-prompt" aria-hidden="true">
                  $
                </span>
                <span class="term-cmd">{createCommand}</span>
              </span>
              <span class="term-copy-lg" aria-hidden="true">
                {copyLabel()}
              </span>
            </button>
            <ol class="start-steps">
              <li>
                Run the command, enter <code>my-app</code>, and install its
                dependencies.
              </li>
              <li>
                Read <code>src/features/todos/add-todo/spec.ts</code> beside its
                <code>impl.ts</code> implementation.
              </li>
              <li>
                Run <code>npm test</code>, then change a scenario and complete
                the implementation that must satisfy it.
              </li>
            </ol>
          </div>
        </section>
      </main>

      <footer class="site-footer">
        <span class="brand-mark small" aria-hidden="true" />
        <p>
          Specter — specification-first, vertically sliced, event-sourced
          TypeScript. The architecture map is a conceptual view of current
          framework contracts.
        </p>
      </footer>
    </div>
  )
}
