import { createSignal, onCleanup, type JSX } from 'solid-js'
import {
  siAngular,
  siDotnet,
  siGo,
  siMongodb,
  siMysql,
  siOpenjdk,
  siPhp,
  siPostgresql,
  siReact,
  siRedis,
  siRuby,
  siRust,
  siSolid,
  siSqlite,
  siSvelte,
  siTypescript,
  siVuedotjs,
  type SimpleIcon,
} from 'simple-icons'

const REPOSITORY_URL = 'https://github.com/devagrawal09/specter'
const CLONE_COMMAND = `git clone ${REPOSITORY_URL}.git`
const AGENT_PROMPT = `Summarize \`${CLONE_COMMAND}\``
const GETTING_STARTED_URL = `${REPOSITORY_URL}/blob/main/docs/getting-started.md`
const THEME_STORAGE_KEY = 'specter-theme'

type Theme = 'light' | 'dark'

function applyTheme(theme: Theme): void {
  document.documentElement.dataset.theme = theme
  document.documentElement.style.colorScheme = theme
  document
    .querySelector<HTMLMetaElement>('meta[name="theme-color"]')
    ?.setAttribute('content', theme === 'light' ? '#f5f7f3' : '#0a0d11')
}

function ThemeToggle(): JSX.Element {
  const initialTheme: Theme =
    document.documentElement.dataset.theme === 'light' ? 'light' : 'dark'
  const [theme, setTheme] = createSignal<Theme>(initialTheme)
  const colorSchemeQuery = window.matchMedia('(prefers-color-scheme: light)')
  let followsSystem = true

  try {
    const storedTheme = localStorage.getItem(THEME_STORAGE_KEY)
    followsSystem = storedTheme !== 'light' && storedTheme !== 'dark'
  } catch {
    // Without storage, keep following the system until this page's toggle is used.
  }

  const followSystemTheme = (event: MediaQueryListEvent) => {
    if (!followsSystem) return

    const systemTheme: Theme = event.matches ? 'light' : 'dark'
    applyTheme(systemTheme)
    setTheme(systemTheme)
  }

  colorSchemeQuery.addEventListener('change', followSystemTheme)
  onCleanup(() =>
    colorSchemeQuery.removeEventListener('change', followSystemTheme),
  )

  const toggleTheme = () => {
    const nextTheme: Theme = theme() === 'light' ? 'dark' : 'light'
    followsSystem = false
    applyTheme(nextTheme)
    setTheme(nextTheme)

    try {
      localStorage.setItem(THEME_STORAGE_KEY, nextTheme)
    } catch {
      // The selected theme still applies when storage is unavailable.
    }
  }

  return (
    <button
      type="button"
      class="theme-toggle"
      role="switch"
      aria-checked={theme() === 'light'}
      aria-label="Light mode"
      title={`Switch to ${theme() === 'light' ? 'dark' : 'light'} mode`}
      onClick={toggleTheme}
    >
      <span class="theme-toggle__glyph" aria-hidden="true">
        {theme() === 'light' ? '☼' : '◐'}
      </span>
      <span class="theme-toggle__label" aria-hidden="true">
        light
      </span>
    </button>
  )
}

function AgentPrompt(): JSX.Element {
  const [copyStatus, setCopyStatus] = createSignal<
    'idle' | 'prompt' | 'command' | 'failed'
  >('idle')

  const copy = async (value: string, success: 'prompt' | 'command') => {
    try {
      await navigator.clipboard.writeText(value)
      setCopyStatus(success)
      setTimeout(() => setCopyStatus('idle'), 1600)
    } catch {
      setCopyStatus('failed')
    }
  }

  return (
    <fieldset class="agent-prompt" aria-label="Specter agent prompt">
      <button
        type="button"
        class="agent-prompt__all"
        aria-label="Copy the complete Specter agent prompt"
        onClick={() => copy(AGENT_PROMPT, 'prompt')}
      >
        <span class="agent-prompt__lead">Summarize</span>{' '}
        <code class="agent-prompt__code">`{CLONE_COMMAND}`</code>
        <span class="agent-prompt__copy">
          {copyStatus() === 'prompt' ? 'copied prompt' : 'copy prompt'}
        </span>
      </button>
      <button
        type="button"
        class="agent-prompt__command"
        aria-label="Copy only the Specter clone command"
        onClick={() => copy(CLONE_COMMAND, 'command')}
      >
        {copyStatus() === 'command' ? 'copied command' : 'copy command'}
      </button>
      <span class="sr-only" aria-live="polite">
        {copyStatus() === 'prompt'
          ? 'Agent prompt copied to clipboard.'
          : copyStatus() === 'command'
            ? 'Clone command copied to clipboard.'
            : copyStatus() === 'failed'
              ? 'Could not copy to the clipboard. Select and copy it manually.'
              : ''}
      </span>
    </fieldset>
  )
}

type StackTechnology = {
  label: string
  icon?: SimpleIcon
  status?: 'official' | 'WIP'
}

type StackGroup = {
  category: string
  technologies: StackTechnology[]
}

function StackLogo(props: StackTechnology): JSX.Element {
  const tooltip = props.status
    ? `${props.label} — ${props.status}`
    : props.label

  return (
    <li>
      <span
        class="stack-logo"
        classList={{ 'stack-logo--more': !props.icon }}
        data-tooltip={tooltip}
        title={tooltip}
        role="img"
        aria-label={tooltip}
        style={props.icon ? `--brand: #${props.icon.hex}` : undefined}
      >
        {props.icon ? (
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d={props.icon.path} />
          </svg>
        ) : (
          <span class="stack-logo__more" aria-hidden="true">
            +…
          </span>
        )}
        {props.status ? (
          <span
            class="stack-logo__status"
            data-status={props.status.toLowerCase()}
            aria-hidden="true"
          >
            {props.status === 'official' ? '✓' : 'WIP'}
          </span>
        ) : null}
      </span>
    </li>
  )
}

type SpecificationFormat = 'typescript' | 'json'

function TypeScriptSpecificationExample(): JSX.Element {
  return (
    <pre class="spec-example__code">
      <code>
        <span class="syntax-key">import</span>
        <span class="syntax-punctuation">{' { '}</span>
        <span class="syntax-variable">createCommandSlice</span>
        <span class="syntax-punctuation">, </span>
        <span class="syntax-variable">event</span>
        <span class="syntax-punctuation">{' } '}</span>
        <span class="syntax-key">from</span>{' '}
        <span class="syntax-string">'@specter-ts/spec'</span>
        {'\n\n'}
        <span class="syntax-key">export default</span>{' '}
        <span class="syntax-function">createCommandSlice</span>
        <span class="syntax-punctuation">(</span>
        <span class="syntax-string">'addTodo'</span>
        <span class="syntax-punctuation">)</span>
        {'\n  '}
        <span class="syntax-punctuation">.</span>
        <span class="syntax-function">description</span>
        <span class="syntax-punctuation">(</span>
        <span class="syntax-string">'Adds a todo when its id is unused.'</span>
        <span class="syntax-punctuation">)</span>
        {'\n  '}
        <span class="syntax-punctuation">.</span>
        <span class="syntax-function">scenarios</span>
        <span class="syntax-punctuation">(</span>
        {'\n    '}
        <span class="syntax-punctuation">{'{'}</span>
        {'\n      '}
        <span class="syntax-variable">description</span>
        <span class="syntax-punctuation">: </span>
        <span class="syntax-string">'Adds a new todo.'</span>
        <span class="syntax-punctuation">,</span>
        {'\n      '}
        <span class="syntax-variable">given</span>
        <span class="syntax-punctuation">: [],</span>
        {'\n      '}
        <span class="syntax-variable">when</span>
        <span class="syntax-punctuation">: {'{'}</span>{' '}
        <span class="syntax-variable">todoId</span>
        <span class="syntax-punctuation">: </span>
        <span class="syntax-string">'todo-1'</span>
        <span class="syntax-punctuation">, </span>
        <span class="syntax-variable">title</span>
        <span class="syntax-punctuation">: </span>
        <span class="syntax-string">'Ship Specter'</span>{' '}
        <span class="syntax-punctuation">{'},'}</span>
        {'\n      '}
        <span class="syntax-variable">expect</span>
        <span class="syntax-punctuation">: [</span>
        <span class="syntax-function">event</span>
        <span class="syntax-punctuation">(</span>
        <span class="syntax-string">'todo-added'</span>
        <span class="syntax-punctuation">, {'{'}</span>{' '}
        <span class="syntax-variable">todoId</span>
        <span class="syntax-punctuation">: </span>
        <span class="syntax-string">'todo-1'</span>
        <span class="syntax-punctuation">, </span>
        <span class="syntax-variable">title</span>
        <span class="syntax-punctuation">: </span>
        <span class="syntax-string">'Ship Specter'</span>{' '}
        <span class="syntax-punctuation">{'}'}</span>
        <span class="syntax-punctuation">)</span>
        <span class="syntax-punctuation">],</span>
        {'\n    '}
        <span class="syntax-punctuation">{'},'}</span>
        {'\n    '}
        <span class="syntax-punctuation">{'{'}</span>
        {'\n      '}
        <span class="syntax-variable">description</span>
        <span class="syntax-punctuation">: </span>
        <span class="syntax-string">'Rejects an existing id.'</span>
        <span class="syntax-punctuation">,</span>
        {'\n      '}
        <span class="syntax-variable">given</span>
        <span class="syntax-punctuation">: [</span>
        <span class="syntax-function">event</span>
        <span class="syntax-punctuation">(</span>
        <span class="syntax-string">'todo-added'</span>
        <span class="syntax-punctuation">, {'{'}</span>{' '}
        <span class="syntax-variable">todoId</span>
        <span class="syntax-punctuation">: </span>
        <span class="syntax-string">'todo-1'</span>
        <span class="syntax-punctuation">, </span>
        <span class="syntax-variable">title</span>
        <span class="syntax-punctuation">: </span>
        <span class="syntax-string">'Ship Specter'</span>{' '}
        <span class="syntax-punctuation">{'}'}</span>
        <span class="syntax-punctuation">)</span>
        <span class="syntax-punctuation">],</span>
        {'\n      '}
        <span class="syntax-variable">when</span>
        <span class="syntax-punctuation">: {'{'}</span>{' '}
        <span class="syntax-variable">todoId</span>
        <span class="syntax-punctuation">: </span>
        <span class="syntax-string">'todo-1'</span>
        <span class="syntax-punctuation">, </span>
        <span class="syntax-variable">title</span>
        <span class="syntax-punctuation">: </span>
        <span class="syntax-string">'Another'</span>{' '}
        <span class="syntax-punctuation">{'},'}</span>
        {'\n      '}
        <span class="syntax-variable">expect</span>
        <span class="syntax-punctuation">: [],</span>
        {'\n      '}
        <span class="syntax-variable">reject</span>
        <span class="syntax-punctuation">: {'{'}</span>{' '}
        <span class="syntax-variable">reason</span>
        <span class="syntax-punctuation">: </span>
        <span class="syntax-string">'Todo already exists'</span>{' '}
        <span class="syntax-punctuation">{'},'}</span>
        {'\n    '}
        <span class="syntax-punctuation">{'},'}</span>
        {'\n  '}
        <span class="syntax-punctuation">)</span>
      </code>
    </pre>
  )
}

function JsonSpecificationExample(): JSX.Element {
  return (
    <pre class="spec-example__code">
      <code>
        <span class="syntax-punctuation">{'{'}</span>
        {'\n  '}
        <span class="syntax-key">"$schema"</span>
        <span class="syntax-punctuation">: </span>
        <span class="syntax-string">
          "https://specter.dev/specification/v1/slice.schema.json"
        </span>
        <span class="syntax-punctuation">,</span>
        {'\n  '}
        <span class="syntax-key">"kind"</span>
        <span class="syntax-punctuation">: </span>
        <span class="syntax-string">"command"</span>
        <span class="syntax-punctuation">,</span>
        {'\n  '}
        <span class="syntax-key">"name"</span>
        <span class="syntax-punctuation">: </span>
        <span class="syntax-string">"addTodo"</span>
        <span class="syntax-punctuation">,</span>
        {'\n  '}
        <span class="syntax-key">"description"</span>
        <span class="syntax-punctuation">: </span>
        <span class="syntax-string">"Adds a todo when its id is unused."</span>
        <span class="syntax-punctuation">,</span>
        {'\n  '}
        <span class="syntax-key">"scenarios"</span>
        <span class="syntax-punctuation">: [{'\n    {'}</span>
        {'\n      '}
        <span class="syntax-key">"description"</span>
        <span class="syntax-punctuation">: </span>
        <span class="syntax-string">"Adds a new todo."</span>
        <span class="syntax-punctuation">,</span>
        {'\n      '}
        <span class="syntax-key">"given"</span>
        <span class="syntax-punctuation">: [],</span>
        {'\n      '}
        <span class="syntax-key">"when"</span>
        <span class="syntax-punctuation">: {'{'}</span>
        {'\n        '}
        <span class="syntax-key">"todoId"</span>
        <span class="syntax-punctuation">: </span>
        <span class="syntax-string">"todo-1"</span>
        <span class="syntax-punctuation">,</span>
        {'\n        '}
        <span class="syntax-key">"title"</span>
        <span class="syntax-punctuation">: </span>
        <span class="syntax-string">"Ship Specter"</span>
        {'\n      '}
        <span class="syntax-punctuation">{'}'}</span>
        <span class="syntax-punctuation">,</span>
        {'\n      '}
        <span class="syntax-key">"expect"</span>
        <span class="syntax-punctuation">: [{'\n        {'}</span>
        {'\n          '}
        <span class="syntax-key">"kind"</span>
        <span class="syntax-punctuation">: </span>
        <span class="syntax-string">"scenario-event"</span>
        <span class="syntax-punctuation">,</span>
        {'\n          '}
        <span class="syntax-key">"eventType"</span>
        <span class="syntax-punctuation">: </span>
        <span class="syntax-string">"todo-added"</span>
        <span class="syntax-punctuation">,</span>
        {'\n          '}
        <span class="syntax-key">"examplePayload"</span>
        <span class="syntax-punctuation">: {'{'}</span>
        {'\n            '}
        <span class="syntax-key">"todoId"</span>
        <span class="syntax-punctuation">: </span>
        <span class="syntax-string">"todo-1"</span>
        <span class="syntax-punctuation">,</span>
        {'\n            '}
        <span class="syntax-key">"title"</span>
        <span class="syntax-punctuation">: </span>
        <span class="syntax-string">"Ship Specter"</span>
        {'\n          '}
        <span class="syntax-punctuation">{'}'}</span>
        {'\n        '}
        <span class="syntax-punctuation">{'}'}</span>
        {'\n      '}
        <span class="syntax-punctuation">]</span>
        {'\n    '}
        <span class="syntax-punctuation">{'}'}</span>
        <span class="syntax-punctuation">,</span>
        {'\n    '}
        <span class="syntax-punctuation">{'{'}</span>
        {'\n      '}
        <span class="syntax-key">"description"</span>
        <span class="syntax-punctuation">: </span>
        <span class="syntax-string">"Rejects an existing id."</span>
        <span class="syntax-punctuation">,</span>
        {'\n      '}
        <span class="syntax-key">"given"</span>
        <span class="syntax-punctuation">: [{'\n        {'}</span>
        {'\n          '}
        <span class="syntax-key">"kind"</span>
        <span class="syntax-punctuation">: </span>
        <span class="syntax-string">"scenario-event"</span>
        <span class="syntax-punctuation">,</span>
        {'\n          '}
        <span class="syntax-key">"eventType"</span>
        <span class="syntax-punctuation">: </span>
        <span class="syntax-string">"todo-added"</span>
        <span class="syntax-punctuation">,</span>
        {'\n          '}
        <span class="syntax-key">"examplePayload"</span>
        <span class="syntax-punctuation">: {'{'}</span>{' '}
        <span class="syntax-key">"todoId"</span>
        <span class="syntax-punctuation">: </span>
        <span class="syntax-string">"todo-1"</span>
        <span class="syntax-punctuation">, </span>
        <span class="syntax-key">"title"</span>
        <span class="syntax-punctuation">: </span>
        <span class="syntax-string">"Ship Specter"</span>{' '}
        <span class="syntax-punctuation">{'}'}</span>
        {'\n        '}
        <span class="syntax-punctuation">{'}'}</span>
        {'\n      '}
        <span class="syntax-punctuation">],</span>
        {'\n      '}
        <span class="syntax-key">"when"</span>
        <span class="syntax-punctuation">: {'{'}</span>{' '}
        <span class="syntax-key">"todoId"</span>
        <span class="syntax-punctuation">: </span>
        <span class="syntax-string">"todo-1"</span>
        <span class="syntax-punctuation">, </span>
        <span class="syntax-key">"title"</span>
        <span class="syntax-punctuation">: </span>
        <span class="syntax-string">"Another"</span>{' '}
        <span class="syntax-punctuation">{'},'}</span>
        {'\n      '}
        <span class="syntax-key">"expect"</span>
        <span class="syntax-punctuation">: [],</span>
        {'\n      '}
        <span class="syntax-key">"reject"</span>
        <span class="syntax-punctuation">: {'{'}</span>{' '}
        <span class="syntax-key">"reason"</span>
        <span class="syntax-punctuation">: </span>
        <span class="syntax-string">"Todo already exists"</span>{' '}
        <span class="syntax-punctuation">{'}'}</span>
        {'\n    '}
        <span class="syntax-punctuation">{'}'}</span>
        {'\n  '}
        <span class="syntax-punctuation">]</span>
        {'\n'}
        <span class="syntax-punctuation">{'}'}</span>
      </code>
    </pre>
  )
}

function SpecificationTabs(): JSX.Element {
  const [format, setFormat] = createSignal<SpecificationFormat>('typescript')
  let typeScriptTab!: HTMLButtonElement
  let jsonTab!: HTMLButtonElement

  const selectFormat = (nextFormat: SpecificationFormat, focus = false) => {
    setFormat(nextFormat)
    if (focus) {
      ;(nextFormat === 'typescript' ? typeScriptTab : jsonTab).focus()
    }
  }

  const handleTabKeyDown: JSX.EventHandler<HTMLButtonElement, KeyboardEvent> = (
    event,
  ) => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return

    event.preventDefault()
    selectFormat(format() === 'typescript' ? 'json' : 'typescript', true)
  }

  const isTypeScript = () => format() === 'typescript'

  return (
    <figure class="spec-example">
      <figcaption class="spec-example__bar">
        <span>
          src/features/todos/add-todo/
          {isTypeScript() ? 'spec.ts' : 'spec.json'}
        </span>
        <div class="spec-example__tabs" role="tablist" aria-label="Spec format">
          <button
            ref={typeScriptTab}
            type="button"
            class="spec-example__tab"
            classList={{ 'spec-example__tab--active': isTypeScript() }}
            role="tab"
            id="typescript-spec-tab"
            aria-selected={isTypeScript()}
            aria-controls="spec-code-panel"
            tabIndex={isTypeScript() ? 0 : -1}
            onClick={() => selectFormat('typescript')}
            onKeyDown={handleTabKeyDown}
          >
            TypeScript
          </button>
          <button
            ref={jsonTab}
            type="button"
            class="spec-example__tab"
            classList={{ 'spec-example__tab--active': !isTypeScript() }}
            role="tab"
            id="json-spec-tab"
            aria-selected={!isTypeScript()}
            aria-controls="spec-code-panel"
            tabIndex={isTypeScript() ? -1 : 0}
            onClick={() => selectFormat('json')}
            onKeyDown={handleTabKeyDown}
          >
            JSON
          </button>
        </div>
      </figcaption>
      <div
        id="spec-code-panel"
        role="tabpanel"
        aria-labelledby={
          isTypeScript() ? 'typescript-spec-tab' : 'json-spec-tab'
        }
      >
        {isTypeScript() ? (
          <TypeScriptSpecificationExample />
        ) : (
          <JsonSpecificationExample />
        )}
      </div>
    </figure>
  )
}

const stack: StackGroup[] = [
  {
    category: 'Languages',
    technologies: [
      { label: 'TypeScript', icon: siTypescript, status: 'official' },
      { label: 'Go', icon: siGo, status: 'WIP' },
      { label: 'Rust', icon: siRust, status: 'WIP' },
      { label: 'Java', icon: siOpenjdk },
      { label: 'Ruby', icon: siRuby },
      { label: 'PHP', icon: siPhp },
      { label: '.NET', icon: siDotnet },
      { label: 'And more' },
    ],
  },
  {
    category: 'Database',
    technologies: [
      { label: 'Postgres', icon: siPostgresql },
      { label: 'SQLite', icon: siSqlite },
      { label: 'MySQL', icon: siMysql },
      { label: 'MongoDB', icon: siMongodb },
      { label: 'And more' },
    ],
  },
  {
    category: 'Frontend',
    technologies: [
      { label: 'React', icon: siReact },
      { label: 'Solid', icon: siSolid },
      { label: 'Vue', icon: siVuedotjs },
      { label: 'Svelte', icon: siSvelte },
      { label: 'Angular', icon: siAngular },
      { label: 'And more' },
    ],
  },
  {
    category: 'Realtime',
    technologies: [{ label: 'Redis', icon: siRedis }, { label: 'And more' }],
  },
]

function ProductivitySections(): JSX.Element {
  return (
    <>
      <section
        class="productivity-section feature-focus content-panel"
        id="one-feature"
      >
        <div class="productivity-copy">
          <h2>Make One Transition Explicit</h2>
          <p>
            Each vertical slice keeps its specification, private state,
            implementation, and tests together. You can see which events it
            reads, what it decides, and which outcomes its scenarios check.
          </p>
          <ul class="productivity-points">
            <li>
              Scenarios describe accepted transitions and rejected commands.
            </li>
            <li>Private state stays behind the feature boundary.</li>
            <li>
              Focused tests run without loading every other implementation.
            </li>
          </ul>
        </div>

        <div class="slice-inspector">
          <div class="slice-inspector__bar">
            <span>src/features/todos/</span>
            <span>3 slices</span>
          </div>
          <div class="slice-inspector__body">
            <ul class="slice-inspector__siblings" aria-label="Todo slices">
              <li class="slice-inspector__sibling slice-inspector__sibling--active">
                add-todo
              </li>
              <li class="slice-inspector__sibling">todos-query</li>
              <li class="slice-inspector__sibling">completion-reaction</li>
            </ul>
            <div class="slice-inspector__focus">
              <div class="slice-inspector__focus-head">
                <strong>addTodo</strong>
                <span>transition scope</span>
              </div>
              <div class="slice-file">
                <code>spec.ts</code>
                <span>histories + outcomes</span>
                <b>fixed</b>
              </div>
              <div class="slice-file">
                <code>impl.ts</code>
                <span>schemas, state, handler</span>
                <b data-state="agent">agent</b>
              </div>
              <div class="slice-file">
                <code>scenarios.test.ts</code>
                <span>focused verification</span>
                <b>generated</b>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section
        class="productivity-section context-section content-panel"
        id="smaller-models"
      >
        <header class="productivity-head">
          <h2>Understand the State Behind a Decision</h2>
          <p>
            A command owns the projection it needs to make a decision. Follow
            its event history, state, and handler in one place, whether you are
            implementing the transition yourself or handing it to a coding
            agent.
          </p>
        </header>

        <div class="context-comparison">
          <div class="context-row context-row--application">
            <div class="context-row__label">
              <strong>Whole application</strong>
              <span>architecture, unrelated features, tests, integrations</span>
            </div>
            <div class="context-meter" aria-hidden="true">
              <span>UI</span>
              <span>API</span>
              <span>DB</span>
              <span>auth</span>
              <span>jobs</span>
              <span>billing</span>
              <span>tests</span>
            </div>
            <small>behavior is spread across the application</small>
          </div>

          <div class="context-divider" aria-hidden="true">
            <span>scope to one slice</span>
            <b>↓</b>
          </div>

          <div class="context-row context-row--slice">
            <div class="context-row__label">
              <strong>One vertical slice</strong>
              <span>exact scenarios and local implementation files</span>
            </div>
            <div class="context-meter" aria-hidden="true">
              <span>spec</span>
              <span>implementation</span>
              <span>tests</span>
            </div>
            <small>one decision, its state, and its checks</small>
          </div>
        </div>
      </section>

      <section
        class="productivity-section parallel-section content-panel"
        id="parallel"
      >
        <header class="productivity-head">
          <h2>Connect Slices Through Explicit Events</h2>
          <p>
            Commands emit facts, Queries expose state, and Reactions respond to
            committed events. Shared event contracts connect the slices while
            each keeps its own state and executable scenarios.
          </p>
        </header>

        <div class="parallel-map">
          <article class="agent-lane">
            <div class="agent-lane__head">
              <span>A</span>
              <strong>Command</strong>
            </div>
            <code>addTodo</code>
            <p>Decide and emit domain facts.</p>
            <b>implementation ✓</b>
          </article>
          <article class="agent-lane">
            <div class="agent-lane__head">
              <span>B</span>
              <strong>Query</strong>
            </div>
            <code>todosQuery</code>
            <p>Project facts into a public result.</p>
            <b>implementation ✓</b>
          </article>
          <article class="agent-lane">
            <div class="agent-lane__head">
              <span>C</span>
              <strong>Reaction</strong>
            </div>
            <code>todoCompletionCheer</code>
            <p>Respond to committed domain facts.</p>
            <b>implementation ✓</b>
          </article>

          <div class="parallel-map__join" aria-hidden="true">
            <span>↓</span>
            <span>↓</span>
            <span>↓</span>
          </div>
          <div class="parallel-map__contract">
            <span>shared event contracts</span>
            <b>registered app</b>
            <span>structural checks</span>
          </div>
        </div>
      </section>

      <section
        class="productivity-section complete-section content-panel"
        id="complete"
      >
        <div class="productivity-copy">
          <h2>An Explicit State Machine in a Real App</h2>
          <p>
            Specifications and handlers share the same event contracts. Specter
            supplies the runtime boundaries, persistence adapters, and scenario
            checks. Your UI and transport connect to the application through
            typed envelopes.
          </p>
          <p class="complete-section__note">
            The Event Log is the source of truth. Each Slice derives the state
            it needs from that history.
          </p>
        </div>

        <div class="application-orbit">
          <div class="application-orbit__item application-orbit__item--behavior">
            <span>Behavior</span>
            <small>exact scenarios</small>
          </div>
          <div class="application-orbit__item application-orbit__item--state">
            <span>State</span>
            <small>stores + adapters</small>
          </div>
          <div class="application-orbit__item application-orbit__item--api">
            <span>API</span>
            <small>typed envelopes</small>
          </div>
          <div class="application-orbit__core">
            <strong>Your state machine</strong>
            <span>explicit in your app</span>
          </div>
          <div class="application-orbit__item application-orbit__item--ui">
            <span>UI</span>
            <small>your framework</small>
          </div>
          <div class="application-orbit__item application-orbit__item--work">
            <span>Background work</span>
            <small>durable reactions</small>
          </div>
          <div class="application-orbit__item application-orbit__item--tests">
            <span>Verification</span>
            <small>scenarios + checks</small>
          </div>
        </div>
      </section>

      <section
        class="productivity-section catches-section content-panel"
        id="catches"
      >
        <header class="productivity-head">
          <h2>What Specter Catches</h2>
          <p>
            Run the Scenario suite to check actual handlers against declared
            histories and outcomes. Construction and runtime checks enforce
            structural contracts alongside those tests.
          </p>
        </header>

        <div class="checks-console">
          <div class="checks-console__bar">
            <span>scenarios + conformance + runtime</span>
            <b>5 guardrails</b>
          </div>
          <div class="checks-console__table-scroll">
            <table>
              <thead>
                <tr>
                  <th scope="col">Implementation mistake</th>
                  <th scope="col">Detected by</th>
                  <th scope="col">
                    <span class="sr-only">Result</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>Output differs from its Scenario</td>
                  <td>Exact Scenario comparison</td>
                  <td>
                    <span class="check-failure">fail</span>
                  </td>
                </tr>
                <tr>
                  <td>Emits an undeclared Event type</td>
                  <td>Command outcome authorization</td>
                  <td>
                    <span class="check-failure">blocked</span>
                  </td>
                </tr>
                <tr>
                  <td>Registers an Event without Scenario coverage</td>
                  <td>Construction conformance</td>
                  <td>
                    <span class="check-failure">reported</span>
                  </td>
                </tr>
                <tr>
                  <td>Registers the wrong implementation</td>
                  <td>Registry/spec name conformance</td>
                  <td>
                    <span class="check-failure">blocked</span>
                  </td>
                </tr>
                <tr>
                  <td>Crosses a private Slice boundary</td>
                  <td>Project boundary checks</td>
                  <td>
                    <span class="check-failure">fail</span>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
          <div class="checks-console__result">
            <span aria-hidden="true">✓</span>
            <strong>
              Declared scenarios checked. Structural contracts enforced.
            </strong>
          </div>
        </div>
        <p class="complete-section__note">
          Verified means checked against the scenarios and constraints you
          declare. These checks do not prove every possible history or input.
          App construction does not run the Scenario suite, and Reaction tests
          check effect values without executing external Plugins.
        </p>
      </section>

      <section class="cta productivity-cta content-panel" id="start">
        <h2>Make Your First State Machine Explicit</h2>
        <p>
          Start with one workflow. Write down the events that establish its
          state, the command that requests a change, and the outcome you expect.
          Implement it yourself or give the specification to your coding agent.
        </p>
        <AgentPrompt />
        <div class="cta__links">
          <a href={GETTING_STARTED_URL}>Read the getting-started guide ↗</a>
          <a href={REPOSITORY_URL}>Explore the repository ↗</a>
        </div>
        <p class="cta__note">
          The 0.4 API is a main-branch preview. The published npm release is
          0.2.1; use the getting-started guide for this preview.
        </p>
      </section>
    </>
  )
}

export function App(): JSX.Element {
  return (
    <div class="page" id="top">
      <a class="skip-link" href="#main-content">
        Skip to content
      </a>

      <header class="topbar">
        <a class="brand" href="#top">
          <span class="brand__mark" aria-hidden="true">
            ▮
          </span>
          <span class="brand__name">Specter</span>
          <span class="brand__tag">0.4 · main</span>
        </a>
        <nav class="topnav" aria-label="Landing page">
          <a class="topnav__link" href="#stack">
            Stack
          </a>
          <a class="topnav__link" href="#why">
            Why Specter
          </a>
          <a class="topnav__link" href="#spec-example">
            Example
          </a>
          <a class="topnav__link" href="#one-feature">
            Slices
          </a>
        </nav>
        <a class="topbar__link" href={GETTING_STARTED_URL}>
          Docs
        </a>
        <ThemeToggle />
        <a class="topbar__cta" href="#start">
          <span class="topbar__cta-full">Get started</span>
          <span class="topbar__cta-short">Get started</span>
        </a>
      </header>

      <main id="main-content" tabIndex={-1}>
        <section class="hero content-panel">
          <h1 class="hero__title">Your State Machine, Explicit and Verified</h1>
          <p class="hero__lede">
            Specter is the framework that makes your state machine explicit and
            verified. Describe event histories, commands, and outcomes in
            executable specifications, then check your real implementation
            against them.
          </p>

          <div class="hero__agent-cta" id="give-to-agent">
            <p>
              <strong>Give it to your agent:</strong>
            </p>
            <AgentPrompt />
          </div>
        </section>

        <section class="band content-panel" id="stack">
          <div class="band__head">
            <h2>Works With Your Stack</h2>
          </div>
          <div class="grid grid--4 stack-grid">
            {stack.map((group) => (
              <article class="stack-card">
                <h3>{group.category}</h3>
                <ul class="stack-list">
                  {group.technologies.map((technology) => (
                    <StackLogo {...technology} />
                  ))}
                </ul>
              </article>
            ))}
          </div>
        </section>

        <article
          class="compiler-article compiler-argument content-panel"
          id="why"
        >
          <header class="compiler-article__head">
            <h2>Your App Already Has a State Machine. Make It Explicit.</h2>
          </header>

          <div
            class="compiler-visual"
            role="img"
            aria-label="Given an event history, derive the state. When a command arrives, decide a transition. Then compare emitted events or a rejection with the scenario's expected outcome."
          >
            <strong class="compiler-visual__label compiler-visual__label--compiler">
              Given
            </strong>
            <span class="compiler-visual__flow">
              event history <b aria-hidden="true">→</b> current state
            </span>
            <strong class="compiler-visual__label compiler-visual__label--llm">
              When
            </strong>
            <span class="compiler-visual__flow">
              state + command <b aria-hidden="true">→</b> decision
            </span>
            <strong class="compiler-visual__label compiler-visual__label--specter">
              Then
            </strong>
            <span class="compiler-visual__flow">
              events or rejection <b aria-hidden="true">→</b> checked outcome
            </span>
          </div>

          <div class="compiler-argument__body">
            <p>
              Every order, approval, or background job has states, transitions,
              and rules about what can happen next.
            </p>
            <p>
              When those rules are scattered across handlers, flags, and
              database writes, the state machine is hard to see and harder to
              check.
            </p>
            <p class="compiler-argument__answer">
              Specter makes the history, decision, and outcome explicit in
              vertical slices. Executable scenarios check the real handlers;
              structural and runtime rules keep their event contracts aligned.
            </p>
          </div>
        </article>

        <section class="spec-result content-panel" id="spec-example">
          <header class="spec-result__head">
            <h2>
              Describe a Transition <span aria-hidden="true">→</span> Check Its
              Implementation
            </h2>
            <p>
              An unused todo ID can be added. An existing ID must be rejected.
              Both rules are written as event histories, commands, and exact
              outcomes that the Scenario runner checks.
            </p>
          </header>

          <div class="spec-result__layout">
            <SpecificationTabs />

            <div class="spec-result__connector" aria-hidden="true">
              <span>verify</span>
              <b>→</b>
            </div>

            <div class="spec-outputs">
              <article class="spec-output">
                <div class="spec-output__icon" aria-hidden="true">
                  ├─
                </div>
                <div>
                  <span class="spec-output__source">Generated by Specter</span>
                  <h3>Architecture and boundaries</h3>
                  <p>
                    A vertical slice scaffold, implementation stages, registry
                    wiring, and isolated state boundaries.
                  </p>
                  <div class="file-tree">
                    <span>add-todo/</span>
                    <span>├─ spec.json</span>
                    <span>├─ impl.ts</span>
                    <span>└─ scenarios.test.ts</span>
                  </div>
                </div>
              </article>

              <article class="spec-output">
                <div
                  class="spec-output__icon spec-output__icon--test"
                  aria-hidden="true"
                >
                  ✓
                </div>
                <div>
                  <span class="spec-output__source">Executable contract</span>
                  <h3>Tests for the specified behavior</h3>
                  <p>
                    The Scenario runner replays each declared history and checks
                    the handler’s events, outputs, or rejection against that
                    scenario’s expected result.
                  </p>
                  <div class="test-result">
                    <span>PASS</span>
                    <code>Adds a new todo.</code>
                  </div>
                </div>
              </article>

              <article class="spec-output">
                <div
                  class="spec-output__icon spec-output__icon--agent"
                  aria-hidden="true"
                >
                  ◆
                </div>
                <div>
                  <span class="spec-output__source">
                    Implemented by you or your agent
                  </span>
                  <h3>Idiomatic application code</h3>
                  <p>
                    Implement schemas, state projections, and business logic
                    inside explicit Slice boundaries, using your chosen stack.
                  </p>
                  <ul
                    class="implementation-stages"
                    aria-label="Implementation stages"
                  >
                    <li>input schema</li>
                    <li>private store</li>
                    <li>event apply</li>
                    <li>handler</li>
                  </ul>
                </div>
              </article>
            </div>
          </div>
        </section>

        <ProductivitySections />
      </main>

      <footer class="foot content-panel">
        <span>Specter · explicit state machines, verified behavior</span>
        <a href={REPOSITORY_URL}>GitHub ↗</a>
      </footer>
    </div>
  )
}
