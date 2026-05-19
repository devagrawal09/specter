import { createFileRoute } from '@tanstack/solid-router'

export const Route = createFileRoute('/variants/vertical-slices')({
  component: VerticalSlicesVariant,
})

const anatomy = [
  {
    name: 'Command',
    detail: 'The intent that changes the system. Inputs stay typed, explicit, and boring.',
    label: 'write',
  },
  {
    name: 'Projection',
    detail: 'The read model shaped for one job, not a shared bucket of maybe-useful state.',
    label: 'read',
  },
  {
    name: 'Reaction',
    detail: 'Side effects declare what they listen to and what they may touch.',
    label: 'effect',
  },
  {
    name: 'View',
    detail: 'UI consumes the slice contract instead of reaching through the application.',
    label: 'screen',
  },
  {
    name: 'Scenarios',
    detail: 'Examples become executable coverage for commands, projections, and reactions.',
    label: 'proof',
  },
]

const boundaries = [
  'No ambient cross-slice imports',
  'Serializable contracts at the edges',
  'Every command owns its validation',
  'Views receive capabilities, not globals',
]

const scenarios = [
  'given an empty board',
  'when CreateTodo runs with valid text',
  'then the todos projection includes the new item',
  'and the cheer reaction can observe the event',
]

function VerticalSlicesVariant() {
  return (
    <main class="vs3-board min-w-0 overflow-hidden">
      <style>{`
        .vs3-board {
          --vs3-paper: #f4f1e8;
          --vs3-paper-deep: #e7e0d0;
          --vs3-ink: #101010;
          --vs3-muted: #53504a;
          --vs3-rule: rgba(16, 16, 16, 0.22);
          --vs3-red: #c92a2a;
          --vs3-blue: #1f5fbf;
          --vs3-tape: rgba(255, 255, 255, 0.62);
          color: var(--vs3-ink);
          min-height: 100vh;
          padding: clamp(1rem, 3vw, 2.5rem);
          background:
            linear-gradient(rgba(16, 16, 16, 0.045) 1px, transparent 1px),
            linear-gradient(90deg, rgba(16, 16, 16, 0.045) 1px, transparent 1px),
            radial-gradient(circle at 18% 12%, rgba(31, 95, 191, 0.09), transparent 18rem),
            radial-gradient(circle at 82% 20%, rgba(201, 42, 42, 0.08), transparent 15rem),
            var(--vs3-paper);
          background-size: 24px 24px, 24px 24px, auto, auto, auto;
        }

        .vs3-page {
          width: min(1180px, 100%);
          margin: 0 auto;
        }

        .vs3-top {
          display: grid;
          grid-template-columns: minmax(0, 0.88fr) minmax(0, 1.12fr);
          gap: clamp(1rem, 3vw, 2rem);
          align-items: stretch;
        }

        .vs3-panel,
        .vs3-module,
        .vs3-note,
        .vs3-code {
          min-width: 0;
          border: 1px solid var(--vs3-ink);
          background: rgba(244, 241, 232, 0.92);
          box-shadow: 6px 6px 0 rgba(16, 16, 16, 0.12);
        }

        .vs3-hero {
          position: relative;
          padding: clamp(1.25rem, 4vw, 3rem);
        }

        .vs3-hero::before,
        .vs3-diagram::before {
          content: '';
          position: absolute;
          inset: 12px;
          pointer-events: none;
          border: 1px dashed rgba(16, 16, 16, 0.32);
        }

        .vs3-kicker {
          display: inline-flex;
          max-width: 100%;
          border-bottom: 2px solid var(--vs3-blue);
          color: var(--vs3-blue);
          font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
          font-size: 0.76rem;
          font-weight: 800;
          letter-spacing: 0.12em;
          text-transform: uppercase;
        }

        .vs3-title {
          max-width: 10ch;
          margin-top: 1rem;
          font-size: clamp(2.65rem, 9vw, 6.6rem);
          font-weight: 950;
          line-height: 0.9;
          letter-spacing: 0;
          text-transform: uppercase;
        }

        .vs3-copy {
          max-width: 42rem;
          margin-top: 1.25rem;
          color: var(--vs3-muted);
          font-size: clamp(1rem, 2vw, 1.12rem);
          line-height: 1.75;
        }

        .vs3-actions {
          display: flex;
          flex-wrap: wrap;
          gap: 0.75rem;
          margin-top: 1.5rem;
        }

        .vs3-button {
          min-width: 0;
          border: 1px solid var(--vs3-ink);
          background: var(--vs3-paper);
          padding: 0.8rem 1rem;
          color: var(--vs3-ink);
          font-size: 0.86rem;
          font-weight: 850;
          text-decoration: none;
          box-shadow: 3px 3px 0 rgba(16, 16, 16, 0.16);
        }

        .vs3-button[disabled] {
          opacity: 0.48;
        }

        .vs3-diagram {
          position: relative;
          padding: clamp(1rem, 2.4vw, 1.5rem);
        }

        .vs3-diagram-head {
          display: flex;
          flex-wrap: wrap;
          align-items: start;
          justify-content: space-between;
          gap: 0.85rem;
          border-bottom: 2px solid var(--vs3-ink);
          padding-bottom: 1rem;
        }

        .vs3-stamp {
          transform: rotate(2deg);
          border: 2px solid var(--vs3-red);
          color: var(--vs3-red);
          padding: 0.24rem 0.55rem;
          font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
          font-size: 0.7rem;
          font-weight: 900;
          letter-spacing: 0.08em;
          text-transform: uppercase;
        }

        .vs3-exploded {
          display: grid;
          grid-template-columns: minmax(0, 1fr);
          gap: 0.75rem;
          margin-top: 1.25rem;
        }

        .vs3-module {
          position: relative;
          display: grid;
          grid-template-columns: minmax(4.5rem, 0.2fr) minmax(0, 1fr);
          gap: 0.9rem;
          padding: 0.95rem;
          background:
            linear-gradient(90deg, rgba(31, 95, 191, 0.09), transparent 34%),
            rgba(244, 241, 232, 0.96);
        }

        .vs3-module:nth-child(even) {
          transform: translateX(clamp(0rem, 3vw, 1.7rem));
        }

        .vs3-module::after {
          content: '';
          position: absolute;
          right: clamp(0.75rem, 4vw, 2.25rem);
          bottom: -0.76rem;
          width: min(42%, 13rem);
          border-bottom: 2px dashed var(--vs3-red);
        }

        .vs3-module:last-child::after {
          display: none;
        }

        .vs3-label {
          align-self: start;
          color: var(--vs3-red);
          font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
          font-size: 0.76rem;
          font-weight: 900;
          text-transform: uppercase;
        }

        .vs3-module h2,
        .vs3-note h2 {
          margin: 0;
          font-size: clamp(1.2rem, 2vw, 1.55rem);
          font-weight: 950;
          line-height: 1;
          text-transform: uppercase;
        }

        .vs3-module p,
        .vs3-note p,
        .vs3-note li {
          color: var(--vs3-muted);
          font-size: 0.95rem;
          line-height: 1.6;
        }

        .vs3-lanes {
          display: grid;
          grid-template-columns: repeat(5, minmax(0, 1fr));
          gap: 0;
          margin-top: clamp(1rem, 3vw, 2rem);
          border: 1px solid var(--vs3-ink);
          background: rgba(255, 255, 255, 0.28);
        }

        .vs3-lane {
          min-width: 0;
          border-right: 1px solid var(--vs3-rule);
          padding: 1rem 0.85rem;
        }

        .vs3-lane:last-child {
          border-right: 0;
        }

        .vs3-lane span {
          display: block;
          color: var(--vs3-blue);
          font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
          font-size: 0.68rem;
          font-weight: 900;
          text-transform: uppercase;
        }

        .vs3-lane strong {
          display: block;
          margin-top: 0.65rem;
          font-size: clamp(0.9rem, 1.5vw, 1.08rem);
          font-weight: 950;
          line-height: 1;
          text-transform: uppercase;
        }

        .vs3-lane p {
          margin-top: 0.8rem;
          color: var(--vs3-muted);
          font-size: 0.82rem;
          line-height: 1.55;
        }

        .vs3-bottom {
          display: grid;
          grid-template-columns: minmax(0, 0.9fr) minmax(0, 1.1fr);
          gap: clamp(1rem, 3vw, 1.5rem);
          margin-top: clamp(1rem, 3vw, 1.5rem);
        }

        .vs3-note {
          padding: clamp(1rem, 2.4vw, 1.5rem);
        }

        .vs3-boundaries,
        .vs3-steps {
          display: grid;
          gap: 0.75rem;
          margin-top: 1rem;
        }

        .vs3-boundary,
        .vs3-step {
          min-width: 0;
          border: 1px solid var(--vs3-rule);
          background: rgba(255, 255, 255, 0.32);
          padding: 0.8rem 0.9rem;
          color: var(--vs3-ink);
          font-size: 0.9rem;
          font-weight: 800;
        }

        .vs3-boundary::before {
          content: '+';
          margin-right: 0.55rem;
          color: var(--vs3-red);
          font-weight: 950;
        }

        .vs3-code {
          margin-top: 1rem;
          background: #111;
          color: #f2f0e7;
          padding: clamp(0.9rem, 2vw, 1.2rem);
          overflow: hidden;
        }

        .vs3-code code {
          display: block;
          max-width: 100%;
          white-space: pre-wrap;
          overflow-wrap: anywhere;
          font-size: clamp(0.72rem, 1.6vw, 0.86rem);
          line-height: 1.65;
        }

        .vs3-harness {
          margin-top: 1rem;
          border-top: 2px solid var(--vs3-blue);
          padding-top: 1rem;
          font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
          font-size: 0.8rem;
          font-weight: 800;
          color: var(--vs3-ink);
        }

        @media (max-width: 900px) {
          .vs3-top,
          .vs3-bottom {
            grid-template-columns: minmax(0, 1fr);
          }

          .vs3-lanes {
            grid-template-columns: repeat(2, minmax(0, 1fr));
          }

          .vs3-lane {
            border-bottom: 1px solid var(--vs3-rule);
          }
        }

        @media (max-width: 560px) {
          .vs3-board {
            padding: 0.75rem;
          }

          .vs3-hero,
          .vs3-diagram,
          .vs3-note {
            box-shadow: 3px 3px 0 rgba(16, 16, 16, 0.14);
          }

          .vs3-title {
            max-width: 8ch;
          }

          .vs3-actions {
            display: grid;
            grid-template-columns: minmax(0, 1fr);
          }

          .vs3-button {
            width: 100%;
            text-align: center;
          }

          .vs3-module {
            grid-template-columns: minmax(0, 1fr);
          }

          .vs3-module:nth-child(even) {
            transform: none;
          }

          .vs3-lanes {
            grid-template-columns: minmax(0, 1fr);
          }

          .vs3-lane {
            border-right: 0;
          }
        }
      `}</style>

      <div class="vs3-page">
        <section class="vs3-top">
          <div class="vs3-panel vs3-hero">
            <p class="vs3-kicker">Variant 3 / architecture board</p>
            <h1 class="vs3-title">
              Draft product behavior by slice.
            </h1>
            <p class="vs3-copy">
              Specter is early-but-real infrastructure for modeling product
              behavior with the current API: commands, projections, reactions,
              views, and the scenarios that keep each module honest.
            </p>
            <div class="vs3-actions">
              <button class="vs3-button" disabled type="button">
                Get started / coming soon
              </button>
              <a class="vs3-button" href="/docs">
                Read more /docs
              </a>
            </div>
          </div>

          <div class="vs3-panel vs3-diagram">
            <div class="vs3-diagram-head">
              <div>
                <p class="vs3-kicker">Exploded module diagram</p>
                <h2 class="mt-2 text-2xl font-black uppercase leading-none">
                  Current API only
                </h2>
              </div>
              <span class="vs3-stamp">explicit</span>
            </div>

            <div class="vs3-exploded">
              {anatomy.map((part) => (
                <article class="vs3-module">
                  <span class="vs3-label">{part.label}</span>
                  <div>
                    <h2>{part.name}</h2>
                    <p>{part.detail}</p>
                  </div>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section class="vs3-lanes" aria-label="Slice lanes">
          {anatomy.map((part, index) => (
            <article class="vs3-lane">
              <span>lane 0{index + 1}</span>
              <strong>{part.name}</strong>
              <p>{part.detail}</p>
            </article>
          ))}
        </section>

        <section class="vs3-bottom">
          <div class="vs3-note">
            <p class="vs3-kicker">Boundary notes</p>
            <h2 class="mt-3">Slices stay legible under pressure.</h2>
            <div class="vs3-boundaries">
              {boundaries.map((boundary) => (
                <div class="vs3-boundary">{boundary}</div>
              ))}
            </div>
          </div>

          <div class="vs3-note">
            <p class="vs3-kicker">Contract specimen</p>
            <h2 class="mt-3">Specs become executable drafting marks.</h2>
            <pre class="vs3-code"><code>{`export const addTodoSliceRegistration =
  createCommandSpec('addTodo')
    .schema(z.object({ title: z.string() }))
    .scenarios({
      given: [],
      when: { title: 'Ship it' },
      expect: [
        todoAddedEvent.create({
          todoId: 'generated',
          title: 'Ship it',
        }),
      ],
    })
    .decide((command) => {
      const title = command.title.trim()
      return [todoAddedEvent.create({
        todoId: crypto.randomUUID(),
        title,
      })]
    })`}</code></pre>
          </div>
        </section>

        <section class="vs3-bottom">
          <article class="vs3-note">
            <p class="vs3-kicker">Scenario rail</p>
            <h2 class="mt-3">Behavior is written once, then run.</h2>
            <ol class="vs3-steps">
              {scenarios.map((step) => (
                <li class="vs3-step">{step}</li>
              ))}
            </ol>
          </article>

          <article class="vs3-note">
            <p class="vs3-kicker">Harness readout</p>
            <h2 class="mt-3">The same examples drive the lab.</h2>
            <p class="mt-4">
              Specter can mount a slice with fake persistence, inspect command
              results, replay reactions, and render the view around a known state.
              That makes the compiler-lab useful before the platform is finished.
            </p>
            <div class="vs3-harness">
              command passed / projection stable / reaction observed / view mounted
            </div>
          </article>
        </section>
      </div>
    </main>
  )
}
