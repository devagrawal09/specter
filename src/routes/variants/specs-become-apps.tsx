import { createFileRoute } from '@tanstack/solid-router'

export const Route = createFileRoute('/variants/specs-become-apps')({
  component: SpecsBecomeApps,
})

const pipeline = [
  {
    step: 'Spec',
    code: 'SPC',
    proof: 'Describe the slice in product language and capture the API it needs.',
  },
  {
    step: 'Scenario',
    code: 'SCN',
    proof: 'Turn the promise into runnable examples that an AI builder can follow.',
  },
  {
    step: 'Test',
    code: 'TST',
    proof: 'Lock behavior with checks that fail before implementation drifts.',
  },
  {
    step: 'Harness',
    code: 'HRN',
    proof: 'Run the slice in isolation with fixtures, state, and current APIs.',
  },
  {
    step: 'App',
    code: 'APP',
    proof: 'Promote the proven slice into the product without rewriting it.',
  },
]

const slices = [
  'Authentication gates',
  'Search and filters',
  'Data mutation flows',
  'Review queues',
]

const scenarios = [
  'Given a saved spec, generate happy-path and edge-path examples.',
  'Keep payloads serializable so traces can be replayed without hidden state.',
  'Surface failing assumptions before code reaches the integrated app.',
]

const harness = [
  'Fixture-driven render states',
  'API-shaped mocks',
  'Command and observation logs',
  'Promotion notes for app integration',
]

function SpecsBecomeApps() {
  return (
    <main class="v1-command page-wrap px-4 py-8 sm:py-12">
      <style>{`
        .v1-command {
          --v1-bg: #020713;
          --v1-panel: rgba(4, 18, 35, 0.92);
          --v1-panel-2: rgba(8, 28, 50, 0.78);
          --v1-line: rgba(76, 231, 255, 0.3);
          --v1-line-strong: rgba(76, 231, 255, 0.68);
          --v1-text: #e5fbff;
          --v1-muted: rgba(196, 231, 238, 0.72);
          --v1-cyan: #4ce7ff;
          --v1-green: #87ffcf;
          --v1-amber: #ffd36a;
          color: var(--v1-text);
          isolation: isolate;
        }

        .v1-command * {
          box-sizing: border-box;
        }

        .v1-shell,
        .v1-panel,
        .v1-terminal,
        .v1-card,
        .v1-cta {
          position: relative;
          border: 1px solid var(--v1-line);
          background:
            linear-gradient(135deg, rgba(76, 231, 255, 0.12), transparent 26%),
            linear-gradient(180deg, var(--v1-panel), rgba(2, 7, 19, 0.96));
          box-shadow: 0 24px 80px rgba(0, 0, 0, 0.38);
        }

        .v1-shell {
          overflow: hidden;
          border-radius: 6px;
          padding: clamp(1.25rem, 4vw, 3rem);
          background:
            linear-gradient(rgba(76, 231, 255, 0.07) 1px, transparent 1px),
            linear-gradient(90deg, rgba(76, 231, 255, 0.07) 1px, transparent 1px),
            radial-gradient(circle at 15% 8%, rgba(76, 231, 255, 0.22), transparent 28%),
            linear-gradient(145deg, #020713 0%, #06172d 58%, #020713 100%);
          background-size: 26px 26px, 26px 26px, auto, auto;
        }

        .v1-shell::before,
        .v1-shell::after,
        .v1-panel::before,
        .v1-card::before,
        .v1-cta::before {
          content: '';
          position: absolute;
          width: 18px;
          height: 18px;
          border-color: var(--v1-line-strong);
          pointer-events: none;
        }

        .v1-shell::before,
        .v1-panel::before,
        .v1-card::before,
        .v1-cta::before {
          left: -1px;
          top: -1px;
          border-left: 2px solid var(--v1-line-strong);
          border-top: 2px solid var(--v1-line-strong);
        }

        .v1-shell::after {
          right: -1px;
          bottom: -1px;
          border-right: 2px solid var(--v1-line-strong);
          border-bottom: 2px solid var(--v1-line-strong);
        }

        .v1-kicker {
          color: var(--v1-cyan);
          font-size: 0.72rem;
          font-weight: 800;
          letter-spacing: 0.16em;
          text-transform: uppercase;
        }

        .v1-title {
          color: var(--v1-text);
          font-size: clamp(3rem, 8.6vw, 6.7rem);
          line-height: 0.9;
          text-transform: uppercase;
          text-shadow: 0 0 28px rgba(76, 231, 255, 0.28);
        }

        .v1-copy {
          color: var(--v1-muted);
        }

        .v1-actions a,
        .v1-actions button {
          border-radius: 2px;
          clip-path: polygon(0 0, calc(100% - 12px) 0, 100% 12px, 100% 100%, 0 100%);
        }

        .v1-panel,
        .v1-terminal,
        .v1-card,
        .v1-cta {
          border-radius: 4px;
        }

        .v1-pipeline {
          position: relative;
        }

        .v1-pipeline::before {
          content: '';
          position: absolute;
          bottom: 20px;
          left: 24px;
          top: 20px;
          width: 1px;
          background: linear-gradient(var(--v1-cyan), rgba(76, 231, 255, 0.05));
        }

        .v1-node {
          position: relative;
          border: 1px solid rgba(76, 231, 255, 0.26);
          background: rgba(2, 12, 26, 0.78);
          clip-path: polygon(0 0, calc(100% - 10px) 0, 100% 10px, 100% 100%, 0 100%);
        }

        .v1-node-index {
          border: 1px solid var(--v1-line-strong);
          background: #04182b;
          color: var(--v1-cyan);
          box-shadow: 0 0 22px rgba(76, 231, 255, 0.18);
        }

        .v1-stage-code,
        .v1-stat {
          font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
        }

        .v1-chip {
          border: 1px solid rgba(135, 255, 207, 0.28);
          background: rgba(135, 255, 207, 0.07);
          color: var(--v1-green);
          clip-path: polygon(0 0, calc(100% - 8px) 0, 100% 8px, 100% 100%, 0 100%);
        }

        .v1-scenario {
          border: 1px dashed rgba(76, 231, 255, 0.34);
          background: rgba(76, 231, 255, 0.06);
          color: var(--v1-muted);
        }

        .v1-harness-tile {
          min-width: 0;
          border: 1px solid rgba(255, 211, 106, 0.24);
          background:
            linear-gradient(90deg, rgba(255, 211, 106, 0.14), transparent 2px),
            rgba(255, 211, 106, 0.05);
          color: var(--v1-text);
        }

        .v1-terminal {
          overflow: hidden;
          background:
            linear-gradient(rgba(76, 231, 255, 0.06) 1px, transparent 1px),
            rgba(1, 8, 18, 0.94);
          background-size: 100% 12px;
        }

        .v1-terminal-row {
          border-left: 2px solid var(--v1-cyan);
          color: var(--v1-muted);
        }

        .v1-terminal-row strong {
          color: var(--v1-text);
        }

        .v1-card h2,
        .v1-cta h2 {
          color: var(--v1-text);
        }

        @media (max-width: 640px) {
          .v1-pipeline::before {
            left: 19px;
          }

          .v1-title {
            overflow-wrap: anywhere;
          }
        }
      `}</style>

      <section class="v1-shell rise-in">
        <div class="grid min-w-0 gap-8 lg:grid-cols-[1.02fr_0.98fr] lg:items-center">
          <div class="min-w-0">
            <p class="v1-kicker mb-3">Specter concept / Variant 1</p>
            <h1 class="v1-title display-title m-0 max-w-4xl font-black">
              Specs become apps.
            </h1>
            <p class="v1-copy mt-5 max-w-2xl text-lg leading-8">
              Specter helps AI builders turn early product intent into runnable
              vertical slices: spec, scenario, test, harness, then app. It is
              early, but the loop is real and it stays close to the current API.
            </p>
            <div class="v1-actions mt-7 flex flex-col gap-3 sm:flex-row sm:items-center">
              <button
                type="button"
                disabled
                class="h-12 cursor-not-allowed border border-[rgba(76,231,255,0.32)] bg-[rgba(76,231,255,0.08)] px-5 text-sm font-extrabold uppercase tracking-[0.12em] text-[rgba(229,251,255,0.58)]"
              >
                Coming soon
              </button>
              <a
                href="/docs"
                class="inline-flex h-12 items-center justify-center border border-[rgba(76,231,255,0.74)] bg-[rgba(76,231,255,0.16)] px-5 text-sm font-extrabold uppercase tracking-[0.12em] text-[var(--v1-text)] no-underline transition hover:bg-[rgba(76,231,255,0.24)]"
              >
                Read the docs
              </a>
            </div>
          </div>

          <div class="v1-panel p-4">
            <div class="v1-pipeline grid gap-3">
              {pipeline.map((item, index) => (
                <article class="v1-node grid min-w-0 grid-cols-[auto_1fr] gap-3 p-3">
                  <span class="v1-node-index grid h-10 w-10 place-items-center text-sm font-black">
                    {index + 1}
                  </span>
                  <div class="min-w-0">
                    <div class="flex min-w-0 items-center justify-between gap-3">
                      <h2 class="m-0 text-sm font-extrabold uppercase text-[var(--v1-text)]">
                        {item.step}
                      </h2>
                      <span class="v1-stage-code shrink-0 text-xs font-bold text-[var(--v1-cyan)]">
                        {item.code}
                      </span>
                    </div>
                    <p class="v1-copy mb-0 mt-1 text-sm leading-6">
                      {item.proof}
                    </p>
                  </div>
                </article>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section class="mt-5 grid gap-4 lg:grid-cols-3">
        <article class="v1-card min-w-0 p-5">
          <p class="v1-kicker mb-2">Vertical slices</p>
          <h2 class="m-0 text-2xl font-extrabold">
            Build the smallest useful path.
          </h2>
          <p class="v1-copy mb-0 mt-3 text-sm leading-7">
            Each slice carries its own product goal, API boundary, fixture data,
            and acceptance signal so AI work stays narrow enough to verify.
          </p>
          <div class="mt-4 grid gap-2">
            {slices.map((slice) => (
              <span class="v1-chip px-3 py-2 text-sm font-bold">
                {slice}
              </span>
            ))}
          </div>
        </article>

        <article class="v1-card min-w-0 p-5">
          <p class="v1-kicker mb-2">Executable scenarios</p>
          <h2 class="m-0 text-2xl font-extrabold">
            Make intent runnable.
          </h2>
          <div class="mt-4 grid gap-3">
            {scenarios.map((scenario) => (
              <p class="v1-scenario m-0 px-4 py-3 text-sm leading-6">
                {scenario}
              </p>
            ))}
          </div>
        </article>

        <article class="v1-card min-w-0 p-5">
          <p class="v1-kicker mb-2">Implementation harness</p>
          <h2 class="m-0 text-2xl font-extrabold">
            Prove it before it joins the app.
          </h2>
          <div class="mt-4 grid grid-cols-2 gap-2">
            {harness.map((item) => (
              <div class="v1-harness-tile min-h-24 p-3">
                <p class="m-0 text-sm font-bold leading-6">
                  {item}
                </p>
              </div>
            ))}
          </div>
        </article>
      </section>

      <section class="v1-terminal mt-5 grid min-w-0 gap-6 p-6 sm:p-8 lg:grid-cols-[0.85fr_1.15fr]">
        <div class="min-w-0">
          <p class="v1-kicker mb-2">Slice isolation</p>
          <h2 class="display-title m-0 text-4xl font-bold">
            Keep experiments contained until they earn integration.
          </h2>
        </div>
        <div class="grid gap-4 sm:grid-cols-3">
          <div>
            <p class="v1-stat m-0 text-3xl font-extrabold text-[var(--v1-cyan)]">
              01
            </p>
            <p class="v1-terminal-row mb-0 mt-2 pl-3 text-sm leading-7">
              Run the slice against realistic fixtures instead of the whole
              product surface.
            </p>
          </div>
          <div>
            <p class="v1-stat m-0 text-3xl font-extrabold text-[var(--v1-cyan)]">
              02
            </p>
            <p class="v1-terminal-row mb-0 mt-2 pl-3 text-sm leading-7">
              Capture observation and command history so regressions have a
              trail.
            </p>
          </div>
          <div>
            <p class="v1-stat m-0 text-3xl font-extrabold text-[var(--v1-cyan)]">
              03
            </p>
            <p class="v1-terminal-row mb-0 mt-2 pl-3 text-sm leading-7">
              Promote only the API-shaped pieces that pass their executable
              scenarios.
            </p>
          </div>
        </div>
      </section>

      <section class="v1-cta mt-5 mb-2 flex min-w-0 flex-col gap-4 p-6 sm:flex-row sm:items-center sm:justify-between sm:p-8">
        <div class="min-w-0">
          <p class="v1-kicker mb-2">
            Early access
          </p>
          <h2 class="m-0 text-2xl font-extrabold">
            Bring one spec. Leave with a working slice.
          </h2>
        </div>
        <div class="v1-actions flex shrink-0 flex-col gap-3 sm:flex-row">
          <button
            type="button"
            disabled
            class="h-12 cursor-not-allowed border border-[rgba(76,231,255,0.26)] bg-[rgba(76,231,255,0.08)] px-5 text-sm font-extrabold uppercase tracking-[0.12em] text-[rgba(229,251,255,0.58)]"
          >
            Coming soon
          </button>
          <a
            href="/docs"
            class="inline-flex h-12 items-center justify-center border border-[rgba(76,231,255,0.74)] bg-[rgba(76,231,255,0.16)] px-5 text-sm font-extrabold uppercase tracking-[0.12em] text-[var(--v1-text)] no-underline transition hover:bg-[rgba(76,231,255,0.24)]"
          >
            Read the docs
          </a>
        </div>
      </section>
    </main>
  )
}
