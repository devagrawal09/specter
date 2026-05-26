import { createSignal, For, Show } from 'solid-js'

import { TodoApp as TodoReferenceApp } from './todo-app'

type VisualKey =
  | 'technical-editorial'
  | 'soft-organic'
  | 'cyber-agentic'
  | 'docs-first'

type NarrativeKey =
  | 'agent-safe-changes'
  | 'executable-specs'
  | 'vertical-event-sourcing'
  | 'docs-first-credibility'

type Visual = {
  key: VisualKey
  label: string
  description: string
}

type Narrative = {
  key: NarrativeKey
  label: string
  eyebrow: string
  headline: string
  subhead: string
  proofTitle: string
  proof: string
  diagram: readonly string[]
}

const visuals: readonly Visual[] = [
  {
    key: 'technical-editorial',
    label: 'Technical Editorial',
    description:
      'Sharp publishing layout, code-forward proof, restrained color.',
  },
  {
    key: 'soft-organic',
    label: 'Soft Organic',
    description: 'Warm cards, humane language, approachable framework story.',
  },
  {
    key: 'cyber-agentic',
    label: 'Cyber Agentic',
    description:
      'Dark agent-console energy with high-contrast system diagrams.',
  },
  {
    key: 'docs-first',
    label: 'Docs First',
    description:
      'Sparse documentation feel for readers evaluating architecture.',
  },
]

const narratives: readonly Narrative[] = [
  {
    key: 'agent-safe-changes',
    label: 'Agent-Safe Changes',
    eyebrow: 'For AI-native TypeScript teams',
    headline: 'Build apps agents can understand before they edit.',
    subhead:
      'Specter turns behavior into typed slices, executable scenarios, and event facts so humans and agents can change code with a shared map.',
    proofTitle: 'A slice gives agents the whole rule nearby',
    proof:
      'Command input, decision state, emitted events, and scenarios live in the same vertical feature instead of scattered across routes, services, queues, and tests.',
    diagram: ['Scenario', 'Command Slice', 'Event Draft', 'Event Log'],
  },
  {
    key: 'executable-specs',
    label: 'Executable Specs',
    eyebrow: 'Specifications that compile',
    headline: 'Stop writing behavior notes that drift from the code.',
    subhead:
      'Specter scenarios are TypeScript contracts attached to slices and views. They explain the behavior and keep verifying it as the app changes.',
    proofTitle: 'The spec is part of the app',
    proof:
      'Scenarios describe given events, command input, and expected outcomes. They run as tests instead of becoming stale Markdown.',
    diagram: [
      'Given Events',
      'When Command Runs',
      'Expect Events',
      'Run Scenario',
    ],
  },
  {
    key: 'vertical-event-sourcing',
    label: 'Vertical Event Sourcing',
    eyebrow: 'Event sourcing without horizontal sprawl',
    headline: 'Keep the event log global and the behavior local.',
    subhead:
      'Each Specter slice owns the state it needs, catches up from the event log, and exposes one command, query, or reaction boundary.',
    proofTitle: 'One log, independent slices',
    proof:
      'Commands decide from private event-derived state. Queries build their own read models. Reactions observe facts and trigger follow-up work.',
    diagram: ['Event Log', 'Command Slice', 'Query Slice', 'Reaction Slice'],
  },
  {
    key: 'docs-first-credibility',
    label: 'Docs-First Credibility',
    eyebrow: 'A framework with a language',
    headline: 'Give your app a glossary agents can obey.',
    subhead:
      'Specter codebases name their concepts explicitly: Events, Slices, Views, Scenarios, and Specter Apps form a stable vocabulary for people and agents.',
    proofTitle: 'The model is inspectable',
    proof:
      'The reference application exists to prove the framework API. The glossary keeps Product Site language separate from demo behavior.',
    diagram: ['Glossary', 'Reference App', 'Runtime Flow', 'Typed Client'],
  },
]

const codeExamples: Record<
  NarrativeKey,
  { title: string; code: string; explanation: string }[]
> = {
  'agent-safe-changes': [
    {
      title: 'Slice Definition',
      code: `export const addTodo = createCommandSlice('addTodo')
  .schema(Schema.Struct({ title: Schema.String }))
  .scenarios([scenario])
  .handle((_db, command) => [
    todoAddedEvent.create({ 
      todoId: crypto.randomUUID(), 
      title: command.title 
    }),
  ])`,
      explanation:
        'Everything an agent needs to understand and modify todo creation lives in one place.',
    },
    {
      title: 'Agent Context',
      code: `// Agents see the complete rule:
// - Input schema (title: string)
// - Business logic (generate ID, emit event)
// - Test scenarios (validation)
// - Output events (TodoAdded)`,
      explanation: 'No hunting across files to understand behavior.',
    },
  ],
  'executable-specs': [
    {
      title: 'Spec as Code',
      code: `.scenario({
  given: [todoAddedEvent.create({ 
    todoId: 'todo-1', 
    title: 'Ship v1.0' 
  })],
  when: { todoId: 'todo-1', completed: true },
  expect: [todoCompletionChangedEvent.create({ 
    todoId: 'todo-1', 
    completed: true 
  })],
})`,
      explanation:
        'Specifications that compile and verify against the running system.',
    },
    {
      title: 'Scenario Validation',
      code: `// Scenarios run in your test suite:
await scenario.verify(specterApp)

// They catch drift:
// PASS Expected: TodoCompleted event
// FAIL Actual: No events emitted`,
      explanation: 'Specs stay synchronized with implementation.',
    },
  ],
  'vertical-event-sourcing': [
    {
      title: 'Slice Catchup',
      code: `const unreadEvents = yield* eventLog.readAfter(
  lastAppliedOrder, 
  eventTypes
)

yield* Effect.forEach(unreadEvents, (event) => {
  const apply = slice.apply[event.type]
  return apply ? apply(event, store.state) : Effect.void
})`,
      explanation:
        'Each slice maintains its own state from the global event log.',
    },
    {
      title: 'Independent Boundaries',
      code: `// Commands decide independently:
commandSlice.handle(state, command) // -> events

// Queries project independently:  
querySlice.apply(state, event) // -> read model

// Reactions observe independently:
reactionSlice.observe(event) // -> side effects`,
      explanation: 'Vertical slices prevent horizontal coupling.',
    },
  ],
  'docs-first-credibility': [
    {
      title: 'Glossary Entry',
      code: `/**
 * A Specter App owns one Event Log, 
 * dispatches commands, answers queries,
 * and runs reactions.
 * 
 * Avoid: Registry pattern
 */
export class SpecterApp {
  constructor(private eventLog: EventLog) {}
}`,
      explanation: 'Explicit vocabulary that agents and humans share.',
    },
    {
      title: 'Reference Proof',
      code: `// This todo app proves the API:
export const specterApp = new SpecterApp(eventLog)
  .withSlices([addTodo, toggleTodo])
  .withViews([TodosView])
  .withReactions([cheerReaction])`,
      explanation: 'The reference app validates the framework design.',
    },
  ],
}

export function AppRouter() {
  const path = window.location.pathname.replace(/\/$/, '') || '/'

  if (path === '/todos') {
    return <TodoRoute />
  }

  const match = path.match(/^\/landing\/([^/]+)\/([^/]+)$/)
  if (match) {
    const visual = visuals.find((item) => item.key === match[1])
    const narrative = narratives.find((item) => item.key === match[2])

    if (visual && narrative) {
      return <LandingVariation visual={visual} narrative={narrative} />
    }
  }

  return <VariationIndex />
}

function TodoRoute() {
  return (
    <>
      <header class="reference-header page-wrap px-4 pt-8">
        <p class="island-kicker m-0">Reference application</p>
        <h1 class="display-title mb-2 mt-1 text-4xl text-[var(--sea-ink)]">
          Specter Todos
        </h1>
        <p class="m-0 max-w-2xl text-sm text-[var(--sea-ink-soft)]">
          This route proves the framework API. It is not the Product Site.
        </p>
        <a class="nav-link mt-3 w-fit text-sm font-semibold" href="/">
          Back to landing matrix
        </a>
      </header>
      <TodoReferenceApp />
    </>
  )
}

function VariationIndex() {
  return (
    <main class="matrix-page">
      <section class="matrix-hero">
        <div class="matrix-hero-content">
          <p class="matrix-kicker">Specter landing matrix</p>
          <h1>16 ways to explain agent-safe TypeScript apps.</h1>
          <p>
            Pick a visual direction and a narrative. Every page has a dummy
            waitlist form and no backend signup behavior.
          </p>
        </div>
        <div class="matrix-hero-actions">
          <a href="/todos" class="matrix-cta-primary">
            Open reference app
          </a>
          <div class="matrix-stats">
            <span>4 visual styles</span>
            <span>x</span>
            <span>4 narratives</span>
            <span>=</span>
            <span>16 variations</span>
          </div>
        </div>
      </section>

      <section class="matrix-grid" aria-label="Landing page variations">
        <For each={visuals}>
          {(visual) => (
            <article class={`matrix-row matrix-row-${visual.key}`}>
              <div class="matrix-row-header">
                <div class="matrix-visual-indicator" />
                <div class="matrix-row-meta">
                  <h2>{visual.label}</h2>
                  <p>{visual.description}</p>
                </div>
              </div>
              <div class="matrix-links">
                <For each={narratives}>
                  {(narrative) => (
                    <a
                      href={`/landing/${visual.key}/${narrative.key}`}
                      class="matrix-link"
                      title={`${visual.label} x ${narrative.label}`}
                    >
                      <span class="matrix-link-label">{narrative.label}</span>
                      <span class="matrix-link-arrow">-&gt;</span>
                    </a>
                  )}
                </For>
              </div>
            </article>
          )}
        </For>
      </section>
    </main>
  )
}

function LandingVariation(props: { visual: Visual; narrative: Narrative }) {
  return (
    <main class={`landing-page ${props.visual.key}`}>
      <NavigationHeader visual={props.visual} narrative={props.narrative} />

      {/* Narrative-specific hero sections */}
      {props.narrative.key === 'agent-safe-changes' && (
        <AgentSafeChangesHero
          visual={props.visual}
          narrative={props.narrative}
        />
      )}
      {props.narrative.key === 'executable-specs' && (
        <ExecutableSpecsHero
          visual={props.visual}
          narrative={props.narrative}
        />
      )}
      {props.narrative.key === 'vertical-event-sourcing' && (
        <VerticalEventSourcingHero
          visual={props.visual}
          narrative={props.narrative}
        />
      )}
      {props.narrative.key === 'docs-first-credibility' && (
        <DocsFirstCredibilityHero
          visual={props.visual}
          narrative={props.narrative}
        />
      )}

      {/* Narrative-specific content sections */}
      {props.narrative.key === 'agent-safe-changes' && (
        <AgentSafeChangesContent />
      )}
      {props.narrative.key === 'executable-specs' && <ExecutableSpecsContent />}
      {props.narrative.key === 'vertical-event-sourcing' && (
        <VerticalEventSourcingContent
          visual={props.visual}
          narrative={props.narrative}
        />
      )}
      {props.narrative.key === 'docs-first-credibility' && (
        <DocsFirstCredibilityContent />
      )}

      <LandingFooter />
    </main>
  )
}

function NavigationHeader(props: { visual: Visual; narrative: Narrative }) {
  return (
    <header class="landing-nav">
      <a href="/" class="landing-brand">
        Specter
      </a>
      <div class="landing-nav-meta">
        <span class="landing-nav-visual">{props.visual.label}</span>
        <span class="landing-nav-separator">x</span>
        <span class="landing-nav-narrative">{props.narrative.label}</span>
      </div>
    </header>
  )
}

function AgentSafeChangesHero(props: { visual: Visual; narrative: Narrative }) {
  return (
    <section class="landing-hero agent-safe-hero">
      <div class="landing-copy">
        <div class="agent-problem-banner">
          <span class="problem-icon">!</span>
          <span class="problem-text">Agent chaos in scattered codebases</span>
        </div>
        <div class="landing-copy-header">
          <p class="landing-kicker">{props.narrative.eyebrow}</p>
          <h1>{props.narrative.headline}</h1>
          <p class="landing-subhead">{props.narrative.subhead}</p>
        </div>
        <DummyWaitlistForm
          source={`${props.visual.key}/${props.narrative.key}`}
        />
      </div>
      <AgentCodeViewer />
    </section>
  )
}

function ExecutableSpecsHero(props: { visual: Visual; narrative: Narrative }) {
  return (
    <section class="landing-hero specs-hero">
      <div class="landing-copy">
        <div class="spec-drift-indicator">
          <div class="drift-badge">Spec Drift Detected</div>
          <div class="drift-details">Documentation ≠ Implementation</div>
        </div>
        <div class="landing-copy-header">
          <p class="landing-kicker">{props.narrative.eyebrow}</p>
          <h1>{props.narrative.headline}</h1>
          <p class="landing-subhead">{props.narrative.subhead}</p>
        </div>
        <DummyWaitlistForm
          source={`${props.visual.key}/${props.narrative.key}`}
        />
      </div>
      <SpecScenarioDemo />
    </section>
  )
}

function VerticalEventSourcingHero(props: {
  visual: Visual
  narrative: Narrative
}) {
  return (
    <section class="landing-hero vertical-hero">
      <div class="event-sourcing-diagram">
        <div class="horizontal-sprawl">
          <div class="sprawl-label">Traditional Horizontal Sprawl</div>
          <div class="sprawl-chaos">
            <span>Controllers</span>
            <span>Services</span>
            <span>Models</span>
            <span>Jobs</span>
            <span>Tests</span>
          </div>
        </div>
        <div class="vertical-arrow">v</div>
        <div class="vertical-slices">
          <div class="slice-label">Vertical Slices</div>
          <div class="slice-columns">
            <div class="slice-column">Commands</div>
            <div class="slice-column">Queries</div>
            <div class="slice-column">Reactions</div>
          </div>
        </div>
      </div>
      <div class="landing-copy">
        <div class="landing-copy-header">
          <p class="landing-kicker">{props.narrative.eyebrow}</p>
          <h1>{props.narrative.headline}</h1>
          <p class="landing-subhead">{props.narrative.subhead}</p>
        </div>
        <DummyWaitlistForm
          source={`${props.visual.key}/${props.narrative.key}`}
        />
      </div>
    </section>
  )
}

function DocsFirstCredibilityHero(props: {
  visual: Visual
  narrative: Narrative
}) {
  return (
    <section class="landing-hero docs-hero">
      <div class="landing-copy">
        <div class="credibility-badge">
          <span class="badge-icon">DOC</span>
          <span class="badge-text">Framework with Documentation DNA</span>
        </div>
        <div class="landing-copy-header">
          <p class="landing-kicker">{props.narrative.eyebrow}</p>
          <h1>{props.narrative.headline}</h1>
          <p class="landing-subhead">{props.narrative.subhead}</p>
        </div>
        <DummyWaitlistForm
          source={`${props.visual.key}/${props.narrative.key}`}
        />
      </div>
      <GlossaryViewer />
    </section>
  )
}

function AgentSafeChangesContent() {
  return (
    <>
      <section class="landing-section behavior-mapping">
        <div class="behavior-comparison">
          <div class="scattered-behavior">
            <h2>Scattered Behavior</h2>
            <div class="scattered-files">
              <div class="file-icon">routes/todo.ts</div>
              <div class="file-icon">services/TodoService.ts</div>
              <div class="file-icon">models/Todo.ts</div>
              <div class="file-icon">jobs/TodoNotification.ts</div>
              <div class="file-icon">tests/todo.test.ts</div>
            </div>
            <p>Agents hunt across files to understand one behavior</p>
          </div>
          <div class="vertical-behavior">
            <h2>Vertical Slice</h2>
            <div class="slice-container">
              <div class="slice-icon">slices/add-todo.ts</div>
              <ul class="slice-contents">
                <li>Schema</li>
                <li>Handler</li>
                <li>Events</li>
                <li>Scenarios</li>
              </ul>
            </div>
            <p>Everything agents need in one place</p>
          </div>
        </div>
      </section>

      <section class="landing-section agent-benefits">
        <div class="benefit-cards">
          <article class="benefit-card">
            <div class="benefit-icon">AI</div>
            <h3>Agent Understanding</h3>
            <p>
              AI can read the complete rule without context switching across
              repositories.
            </p>
          </article>
          <article class="benefit-card">
            <div class="benefit-icon">OK</div>
            <h3>Change Safety</h3>
            <p>
              Scenarios validate agent modifications before they reach
              production.
            </p>
          </article>
          <article class="benefit-card">
            <div class="benefit-icon">LOC</div>
            <h3>Behavior Locality</h3>
            <p>
              Each feature lives in one slice with its complete decision logic.
            </p>
          </article>
        </div>
      </section>
    </>
  )
}

function ExecutableSpecsContent() {
  return (
    <>
      <section class="landing-section spec-comparison">
        <div class="spec-types">
          <div class="static-specs">
            <h2>Static Documentation</h2>
            <div class="static-example">
              <div class="doc-header">todo-behavior.md</div>
              <div class="doc-content">
                <p>When user completes todo...</p>
                <p>FAIL Stale after 3 months</p>
                <p>FAIL No validation</p>
                <p>FAIL Separate from code</p>
              </div>
            </div>
          </div>
          <div class="executable-specs">
            <h2>Executable Specifications</h2>
            <div class="executable-example">
              <div class="spec-header">complete-todo.scenario.ts</div>
              <div class="spec-content">
                <p>Scenario validates behavior</p>
                <p>PASS Runs in test suite</p>
                <p>PASS Catches drift</p>
                <p>PASS Lives with slice</p>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section class="landing-section scenario-flow">
        <h2>Scenario Lifecycle</h2>
        <div class="flow-steps">
          <div class="flow-step">
            <div class="step-number">1</div>
            <div class="step-content">
              <h3>Write Scenario</h3>
              <p>Define given events, when command, expect events</p>
            </div>
          </div>
          <div class="flow-arrow">-&gt;</div>
          <div class="flow-step">
            <div class="step-number">2</div>
            <div class="step-content">
              <h3>Run Tests</h3>
              <p>Scenarios execute against live slices</p>
            </div>
          </div>
          <div class="flow-arrow">-&gt;</div>
          <div class="flow-step">
            <div class="step-number">3</div>
            <div class="step-content">
              <h3>Catch Drift</h3>
              <p>Failing scenarios reveal spec mismatches</p>
            </div>
          </div>
        </div>
      </section>
    </>
  )
}

function VerticalEventSourcingContent(props: {
  visual: Visual
  narrative: Narrative
}) {
  return (
    <>
      <section class="landing-section event-sourcing-model">
        <div class="model-content">
          <p class="landing-kicker">Architecture</p>
          <h2>{props.narrative.proofTitle}</h2>
          <p>{props.narrative.proof}</p>
        </div>
        <div class="event-log-visualization">
          <div class="global-log">
            <div class="log-header">Global Event Log</div>
            <div class="log-events">
              <div class="event-entry">TodoAdded</div>
              <div class="event-entry">TodoCompleted</div>
              <div class="event-entry">CheerCreated</div>
            </div>
          </div>
          <div class="slice-projections">
            <div class="projection">Commands</div>
            <div class="projection">Queries</div>
            <div class="projection">Reactions</div>
          </div>
        </div>
      </section>

      <section class="landing-section slice-types">
        <div class="slice-type-cards">
          <article class="slice-type-card">
            <div class="slice-type-header">
              <div class="slice-icon">CMD</div>
              <h3>Command Slices</h3>
            </div>
            <p>Handle user input, validate business rules, emit events</p>
            <div class="slice-example">handle(state, cmd) -&gt; events</div>
          </article>
          <article class="slice-type-card">
            <div class="slice-type-header">
              <div class="slice-icon">QRY</div>
              <h3>Query Slices</h3>
            </div>
            <p>Build read models from events, answer questions</p>
            <div class="slice-example">
              apply(state, event) -&gt; projection
            </div>
          </article>
          <article class="slice-type-card">
            <div class="slice-type-header">
              <div class="slice-icon">RXN</div>
              <h3>Reaction Slices</h3>
            </div>
            <p>Observe events, trigger side effects, emit follow-ups</p>
            <div class="slice-example">observe(event) -&gt; side effects</div>
          </article>
        </div>
      </section>
    </>
  )
}

function DocsFirstCredibilityContent() {
  return (
    <>
      <section class="landing-section glossary-section">
        <div class="glossary-content">
          <h2>Specter Glossary</h2>
          <p>A stable vocabulary that humans and agents share</p>
        </div>
        <div class="glossary-terms">
          <div class="term-card">
            <h3>Event</h3>
            <p>A durable fact that happened in the system</p>
          </div>
          <div class="term-card">
            <h3>Slice</h3>
            <p>A vertical feature boundary with one responsibility</p>
          </div>
          <div class="term-card">
            <h3>Scenario</h3>
            <p>An executable specification attached to a slice</p>
          </div>
          <div class="term-card">
            <h3>View</h3>
            <p>A UI component bound to typed queries and commands</p>
          </div>
        </div>
      </section>

      <section class="landing-section reference-proof">
        <div class="proof-content">
          <h2>Reference Application</h2>
          <p>
            The todo app exists to prove the framework API works as documented.
          </p>
          <div class="reference-link">
            <a href="/todos" class="reference-cta">
              Explore Reference App
            </a>
          </div>
        </div>
        <div class="api-surface">
          <div class="api-section">
            <h3>Core API</h3>
            <ul class="api-list">
              <li>createCommandSlice()</li>
              <li>createQuerySlice()</li>
              <li>createReactionSlice()</li>
              <li>createEvent()</li>
            </ul>
          </div>
          <div class="api-section">
            <h3>Runtime</h3>
            <ul class="api-list">
              <li>SpecterApp</li>
              <li>EventLog</li>
              <li>SliceRegistry</li>
              <li>ScenarioRunner</li>
            </ul>
          </div>
        </div>
      </section>
    </>
  )
}

function LandingFooter() {
  return (
    <footer class="landing-footer">
      <div class="landing-footer-content">
        <a href="/todos" class="footer-link">
          Reference app
        </a>
        <a href="/" class="footer-link">
          All variations
        </a>
      </div>
    </footer>
  )
}

function AgentCodeViewer() {
  const [activeExample, setActiveExample] = createSignal(0)
  const examples = codeExamples['agent-safe-changes']

  return (
    <aside class="code-viewer">
      <div class="code-viewer-header">
        <div class="code-tabs">
          <For each={examples}>
            {(example, index) => (
              <button
                type="button"
                class={`code-tab ${index() === activeExample() ? 'active' : ''}`}
                onClick={() => setActiveExample(index())}
              >
                {example.title}
              </button>
            )}
          </For>
        </div>
        <div class="code-status">
          <span class="status-dot" />
          <span class="status-text">Agent Readable</span>
        </div>
      </div>
      <div class="code-content">
        <pre class="code-block">
          <code>{examples[activeExample()].code}</code>
        </pre>
        <div class="code-explanation">
          {examples[activeExample()].explanation}
        </div>
      </div>
    </aside>
  )
}

function SpecScenarioDemo() {
  const [activeExample, setActiveExample] = createSignal(0)
  const examples = codeExamples['executable-specs']

  return (
    <aside class="scenario-demo">
      <div class="scenario-header">
        <div class="scenario-tabs">
          <For each={examples}>
            {(example, index) => (
              <button
                type="button"
                class={`scenario-tab ${index() === activeExample() ? 'active' : ''}`}
                onClick={() => setActiveExample(index())}
              >
                {example.title}
              </button>
            )}
          </For>
        </div>
        <div class="scenario-status">
          <span class="status-dot passing" />
          <span class="status-text">Passing</span>
        </div>
      </div>
      <div class="scenario-content">
        <pre class="scenario-code">
          <code>{examples[activeExample()].code}</code>
        </pre>
        <div class="scenario-explanation">
          {examples[activeExample()].explanation}
        </div>
      </div>
    </aside>
  )
}

function GlossaryViewer() {
  const [activeExample, setActiveExample] = createSignal(0)
  const examples = codeExamples['docs-first-credibility']

  return (
    <aside class="glossary-viewer">
      <div class="glossary-header">
        <div class="glossary-tabs">
          <For each={examples}>
            {(example, index) => (
              <button
                type="button"
                class={`glossary-tab ${index() === activeExample() ? 'active' : ''}`}
                onClick={() => setActiveExample(index())}
              >
                {example.title}
              </button>
            )}
          </For>
        </div>
        <div class="glossary-status">
          <span class="status-dot" />
          <span class="status-text">Documented</span>
        </div>
      </div>
      <div class="glossary-content">
        <pre class="glossary-code">
          <code>{examples[activeExample()].code}</code>
        </pre>
        <div class="glossary-explanation">
          {examples[activeExample()].explanation}
        </div>
      </div>
    </aside>
  )
}

function DummyWaitlistForm(props: { source: string }) {
  const [email, setEmail] = createSignal('')
  const [submitted, setSubmitted] = createSignal(false)

  return (
    <div class="waitlist-section">
      <form
        class="waitlist-form"
        onSubmit={(event) => {
          event.preventDefault()
          if (!email().trim()) return
          setSubmitted(true)
        }}
      >
        <div class="waitlist-form-header">
          <label for={`email-${props.source}`}>
            Join the early access list
          </label>
          <Show when={!submitted()}>
            <span class="waitlist-badge">Early Access</span>
          </Show>
        </div>
        <div class="waitlist-form-controls">
          <div class="waitlist-input-wrapper">
            <input
              id={`email-${props.source}`}
              type="email"
              value={email()}
              onInput={(event) => {
                setEmail(event.currentTarget.value)
                setSubmitted(false)
              }}
              placeholder="you@example.com"
              class="waitlist-input"
            />
          </div>
          <button type="submit" class="waitlist-button">
            Join waitlist
          </button>
        </div>
        <div class="waitlist-status">
          <Show
            when={submitted()}
            fallback={
              <small class="waitlist-meta">
                Dummy form - Source: {props.source}
              </small>
            }
          >
            <small class="waitlist-success">
              You are on the dummy waitlist for {props.source}
            </small>
          </Show>
        </div>
      </form>
    </div>
  )
}
