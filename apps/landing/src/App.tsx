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
        </nav>
        <a class="topbar__link" href={GETTING_STARTED_URL}>
          Docs
        </a>
        <ThemeToggle />
        <a class="topbar__cta" href="#give-to-agent">
          <span class="topbar__cta-full">Give it to your agent</span>
          <span class="topbar__cta-short">Give to agent</span>
        </a>
      </header>

      <main id="main-content" tabIndex={-1}>
        <section class="hero content-panel">
          <h1 class="hero__title">Compile JSON Specs into Complete Apps</h1>
          <p class="hero__lede">
            Specter is a framework for authoring specifications that can be
            compiled into complete, well-architected, fully tested applications
            using coding agents.
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
            <h2>LLMs generate code. Specter makes it trustworthy.</h2>
          </header>

          <div
            class="compiler-visual"
            role="img"
            aria-label="A compiler maps source to deterministic output. An LLM alone produces plausible code. Specter combines the specification with generated constraints to produce an implementation verified against the specification."
          >
            <strong class="compiler-visual__label compiler-visual__label--compiler">
              compiler
            </strong>
            <span class="compiler-visual__flow">
              source <b aria-hidden="true">→</b> deterministic output
            </span>
            <strong class="compiler-visual__label compiler-visual__label--llm">
              LLM alone
            </strong>
            <span class="compiler-visual__flow">
              spec <b aria-hidden="true">→</b> plausible code
            </span>
            <strong class="compiler-visual__label compiler-visual__label--specter">
              Specter
            </strong>
            <span class="compiler-visual__flow">
              spec + constraints <b aria-hidden="true">→</b> verified against
              spec
            </span>
          </div>

          <div class="compiler-argument__body">
            <p>
              Compilers are trusted because source code constrains their output.
              LLMs are useful because they can invent an implementation.
            </p>
            <p>
              That flexibility becomes a liability when the model can also
              invent architecture, skip required behavior, or change what the
              specification means.
            </p>
            <p class="compiler-argument__answer">
              Specter compiles structure, boundaries, and tests from the
              specification, then lets the agent fill in the implementation. The
              code can vary. The specified behavior cannot.
            </p>
          </div>
        </article>
      </main>

      <footer class="foot content-panel">
        <span>Specter · specifications for agent-built applications</span>
        <a href={REPOSITORY_URL}>GitHub ↗</a>
      </footer>
    </div>
  )
}
