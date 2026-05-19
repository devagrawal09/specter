import { createFileRoute } from '@tanstack/solid-router'

export const Route = createFileRoute('/variants/spec-compiler')({
  component: SpecCompilerVariant,
})

const inputs = [
  {
    label: 'Specs',
    title: 'State the behavior',
    body: 'Name the command, projection, or reaction. Define what it accepts, what it reads, and which events it may emit.',
  },
  {
    label: 'Schemas',
    title: 'Constrain the boundary',
    body: 'Attach runtime validators so the compiler can reject malformed inputs before they reach a slice.',
  },
  {
    label: 'Scenarios',
    title: 'Pin the contract',
    body: 'Describe given, when, and expect cases that become executable checks instead of prose that drifts.',
  },
]

const targets = [
  'Scenario tests',
  'Runtime registry entries',
  'Slice harness wiring',
  'App scaffold checkpoints',
]

const diagnostics = [
  {
    title: 'Failing scenarios',
    body: 'Expected events, commands, or visible UI assertions do not match the slice result.',
  },
  {
    title: 'Invalid schemas',
    body: 'A command or projection input cannot be parsed by its declared validator.',
  },
  {
    title: 'Boundary violations',
    body: 'A slice reaches beyond the events, store transaction, or component contract it declared.',
  },
]

const apiExample = `export const todosViewSliceRegistration =
  createProjectionSpec('todosView')
  .schema(TodosSearchSchema)
  .apply({
    [todoAddedEvent.type]: (event, tx) => {
      tx.insert(todoListItems).values({
        id: event.payload.todoId,
        title: event.payload.title,
        completed: false,
      }).run()
    },
  })
  .scenarios({
    given: [todoAddedEvent.create({
      todoId: 'todo-1',
      title: 'Write the spec first',
    })],
    when: { status: 'all' },
    expect: {
      visible: ['todo-list'],
      text: {
        'todo-title-todo-1': 'Write the spec first',
      },
    },
  })
  .component(TodosView)`

function SpecCompilerVariant() {
  return (
    <main class="spec4-lab min-w-0 px-3 py-6 sm:px-4 sm:py-10">
      <style>{`
        .spec4-lab {
          --spec4-bg: #050806;
          --spec4-panel: #0a100c;
          --spec4-panel-2: #10170f;
          --spec4-grid: rgba(133, 255, 169, 0.08);
          --spec4-green: #83ff9f;
          --spec4-green-soft: #b6ffc7;
          --spec4-amber: #ffc860;
          --spec4-red: #ff6b5f;
          --spec4-ink: #e6ffe9;
          --spec4-muted: rgba(230, 255, 233, 0.68);
          --spec4-line: rgba(131, 255, 159, 0.26);
          background:
            linear-gradient(rgba(131, 255, 159, 0.035) 1px, transparent 1px),
            linear-gradient(90deg, rgba(131, 255, 159, 0.026) 1px, transparent 1px),
            radial-gradient(circle at 70% 0%, rgba(255, 200, 96, 0.14), transparent 36rem),
            var(--spec4-bg);
          background-size: 100% 3px, 34px 34px, auto, auto;
          color: var(--spec4-ink);
          font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
          overflow-x: clip;
        }

        .spec4-wrap {
          width: min(1120px, 100%);
          margin-inline: auto;
        }

        .spec4-terminal {
          position: relative;
          border: 1px solid var(--spec4-line);
          background: linear-gradient(180deg, rgba(14, 28, 17, 0.95), rgba(5, 8, 6, 0.98));
          box-shadow: 0 0 0 1px rgba(131, 255, 159, 0.08) inset, 0 24px 70px rgba(0, 0, 0, 0.48);
        }

        .spec4-terminal::before {
          content: "";
          position: absolute;
          inset: 0;
          pointer-events: none;
          background: repeating-linear-gradient(180deg, transparent 0 7px, rgba(230, 255, 233, 0.025) 8px);
          mix-blend-mode: screen;
        }

        .spec4-kicker {
          color: var(--spec4-amber);
          font-size: 0.72rem;
          font-weight: 800;
          letter-spacing: 0;
          text-transform: uppercase;
        }

        .spec4-title {
          color: var(--spec4-green-soft);
          font-size: clamp(2.2rem, 8vw, 5.35rem);
          line-height: 0.94;
          letter-spacing: 0;
          text-shadow: 0 0 24px rgba(131, 255, 159, 0.28);
        }

        .spec4-copy {
          color: var(--spec4-muted);
        }

        .spec4-btn {
          width: 100%;
          min-width: 0;
          border: 1px solid rgba(131, 255, 159, 0.32);
          background: rgba(131, 255, 159, 0.08);
          color: var(--spec4-green-soft);
          text-wrap: balance;
          white-space: normal;
          box-shadow: 0 0 22px rgba(131, 255, 159, 0.08) inset;
        }

        .spec4-btn-secondary {
          border-color: rgba(255, 200, 96, 0.34);
          background: rgba(255, 200, 96, 0.08);
          color: var(--spec4-amber);
        }

        .spec4-panel {
          border: 1px solid var(--spec4-line);
          background: linear-gradient(180deg, rgba(16, 23, 15, 0.95), rgba(8, 13, 9, 0.96));
          box-shadow: 0 0 0 1px rgba(230, 255, 233, 0.04) inset;
        }

        .spec4-strip {
          border-left: 0.38rem solid var(--strip);
          background: rgba(230, 255, 233, 0.045);
        }

        .spec4-code {
          max-width: 100%;
          overflow: hidden;
          white-space: pre-wrap;
          overflow-wrap: anywhere;
          word-break: break-word;
          color: var(--spec4-green-soft);
        }

        .spec4-code code {
          white-space: inherit;
          overflow-wrap: inherit;
          word-break: inherit;
        }

        @media (min-width: 640px) {
          .spec4-btn {
            width: auto;
          }
        }
      `}</style>

      <section class="spec4-wrap">
        <div class="spec4-terminal rise-in overflow-hidden rounded-lg">
          <div class="flex items-center justify-between gap-3 border-b border-[rgba(131,255,159,0.22)] px-4 py-3 text-xs text-[var(--spec4-muted)] sm:px-5">
            <span class="min-w-0 truncate">specter-spec://variant-04</span>
            <span class="shrink-0 text-[var(--spec4-green)]">READY</span>
          </div>
          <div class="relative grid gap-8 p-5 sm:p-7 lg:grid-cols-[1.05fr_0.95fr] lg:p-9">
            <div class="flex min-w-0 flex-col justify-center">
              <p class="spec4-kicker mb-3">Variant 4 / compiler diagnostics</p>
              <h1 class="spec4-title m-0 max-w-4xl font-black">
                App specs in. Checked artifacts out.
              </h1>
              <p class="spec4-copy mt-5 max-w-2xl text-base leading-7 sm:text-lg sm:leading-8">
                Specter reads slice specifications and emits grounded
                development artifacts: scenario checks, registry metadata,
                harness wiring, and scaffold checkpoints. It compiles declared
                contracts, not finished products.
              </p>
              <div class="mt-8 flex flex-col gap-3 sm:flex-row">
                <button
                  type="button"
                  disabled
                  class="spec4-btn inline-flex min-h-12 cursor-not-allowed items-center justify-center rounded px-4 text-center text-sm font-bold opacity-70 sm:px-5"
                >
                  Starter repo pending
                </button>
                <a
                  href="/docs"
                  class="spec4-btn spec4-btn-secondary inline-flex min-h-12 items-center justify-center rounded px-4 text-center text-sm font-bold no-underline transition hover:bg-[rgba(255,200,96,0.14)] hover:text-[var(--spec4-amber)] sm:px-5"
                >
                  Read docs
                </a>
              </div>
            </div>

            <div class="spec4-panel min-w-0 rounded-lg p-4">
              <div class="rounded border border-[rgba(131,255,159,0.2)] bg-black/30 p-4">
                <div class="flex flex-wrap items-center justify-between gap-2 border-b border-[rgba(131,255,159,0.18)] pb-3">
                  <span class="text-xs font-bold uppercase text-[var(--spec4-muted)]">
                    Compile passes
                  </span>
                  <span class="rounded border border-[rgba(131,255,159,0.32)] bg-[rgba(131,255,159,0.1)] px-3 py-1 text-xs font-bold text-[var(--spec4-green)]">
                    contract parseable
                  </span>
                </div>
                <div class="mt-5 grid gap-3">
                  {targets.map((target, index) => (
                    <div class="grid min-w-0 grid-cols-[auto_1fr] items-center gap-3 rounded border border-[rgba(230,255,233,0.1)] bg-[rgba(230,255,233,0.045)] px-3 py-3">
                      <span class="grid h-7 w-9 place-items-center rounded-sm bg-[rgba(131,255,159,0.16)] text-xs font-black text-[var(--spec4-green)]">
                        P{index + 1}
                      </span>
                      <span class="min-w-0 text-sm font-semibold text-[var(--spec4-ink)]">
                        {target}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section class="spec4-wrap mt-5 grid gap-4 md:grid-cols-3">
        {inputs.map((input) => (
          <article class="spec4-panel min-w-0 rounded-lg p-5">
            <p class="spec4-kicker mb-3">{input.label}</p>
            <h2 class="m-0 text-xl font-bold text-[var(--spec4-green-soft)]">
              {input.title}
            </h2>
            <p class="spec4-copy mb-0 mt-3 text-sm leading-7">
              {input.body}
            </p>
          </article>
        ))}
      </section>

      <section class="spec4-wrap mt-5 grid gap-5 lg:grid-cols-[0.88fr_1.12fr]">
        <div class="spec4-panel min-w-0 rounded-lg p-5 sm:p-6">
          <p class="spec4-kicker mb-3">Compilation targets</p>
          <h2 class="m-0 text-2xl font-black leading-tight text-[var(--spec4-green-soft)] sm:text-3xl">
            One specification, several grounded outputs.
          </h2>
          <p class="spec4-copy mt-4 text-base leading-8">
            The compiler reads slice-level intent and emits artifacts that can
            be checked, registered, mounted, or used to start a feature. Each
            output stays tied to the declared schema and scenarios.
          </p>
          <div class="mt-6 grid gap-3">
            {targets.map((target, index) => (
              <div
                class="spec4-strip rounded px-4 py-3 text-sm font-bold text-[var(--spec4-ink)]"
                style={`--strip: ${
                  index === 3 ? 'var(--spec4-amber)' : 'var(--spec4-green)'
                }`}
              >
                {target}
              </div>
            ))}
          </div>
        </div>

        <div
          id="diagnostics"
          class="spec4-panel min-w-0 rounded-lg p-5 sm:p-6"
        >
          <p class="spec4-kicker mb-3">Diagnostics</p>
          <h2 class="m-0 text-2xl font-black leading-tight text-[var(--spec4-green-soft)] sm:text-3xl">
            Make broken contracts legible.
          </h2>
          <div class="mt-6 grid gap-3">
            {diagnostics.map((diagnostic, index) => (
              <article
                class="spec4-strip min-w-0 rounded p-4"
                style={`--strip: ${
                  index === 0
                    ? 'var(--spec4-red)'
                    : index === 1
                      ? 'var(--spec4-amber)'
                      : 'var(--spec4-green)'
                }`}
              >
                <div class="mb-2 text-xs font-black uppercase text-[var(--strip)]">
                  {index === 0 ? 'error' : index === 1 ? 'warning' : 'success'}
                </div>
                <h3 class="m-0 text-base font-bold text-[var(--spec4-ink)]">
                  {diagnostic.title}
                </h3>
                <p class="spec4-copy mb-0 mt-2 text-sm leading-7">
                  {diagnostic.body}
                </p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section
        id="api"
        class="spec4-wrap mt-5 grid gap-5 pb-10 lg:grid-cols-[0.9fr_1.1fr]"
      >
        <div class="spec4-panel min-w-0 rounded-lg p-5 sm:p-6">
          <p class="spec4-kicker mb-3">Current API</p>
          <h2 class="m-0 text-2xl font-black leading-tight text-[var(--spec4-green-soft)] sm:text-3xl">
            Specs stay close to the slice.
          </h2>
          <p class="spec4-copy mt-4 text-base leading-8">
            A <code>createProjectionSpec</code> or{' '}
            <code>createCommandSpec</code> chain is the source language. Specter
            can compile what is declared there into repeatable checks and
            runtime registration data.
          </p>
          <div class="mt-6 flex flex-col gap-3 sm:flex-row">
            <button
              type="button"
              disabled
              class="spec4-btn inline-flex min-h-12 cursor-not-allowed items-center justify-center rounded px-4 text-center text-sm font-bold opacity-70 sm:px-5"
            >
              Starter repo coming soon
            </button>
            <a
              href="/docs"
              class="spec4-btn spec4-btn-secondary inline-flex min-h-12 items-center justify-center rounded px-4 text-center text-sm font-bold no-underline transition hover:bg-[rgba(255,200,96,0.14)] hover:text-[var(--spec4-amber)] sm:px-5"
            >
              Read the prelim docs
            </a>
          </div>
        </div>

        <pre class="spec4-code m-0 min-w-0 rounded-lg border border-[rgba(131,255,159,0.24)] bg-black/50 p-4 text-xs leading-6 shadow-[0_0_35px_rgba(131,255,159,0.08)_inset] sm:p-5 sm:text-sm">
          <code class="border-0 bg-transparent p-0 text-[0.84rem] text-inherit">
            {apiExample}
          </code>
        </pre>
      </section>
    </main>
  )
}
