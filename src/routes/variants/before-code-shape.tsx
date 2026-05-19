import { createFileRoute } from '@tanstack/solid-router'

export const Route = createFileRoute('/variants/before-code-shape')({
  component: BeforeCodeShape,
})

function BeforeCodeShape() {
  return (
    <main class="v5-blueprint min-h-screen overflow-x-hidden bg-[#f8f7f2] text-[#111111]">
      <style>{`
        .v5-blueprint {
          --paper: #f8f7f2;
          --ink: #111111;
          --muted: #62615b;
          --line: rgba(17, 17, 17, 0.18);
          --line-strong: rgba(17, 17, 17, 0.44);
          --accent: #237b72;
          --accent-soft: rgba(35, 123, 114, 0.14);
          --glass: rgba(255, 255, 255, 0.48);
          --glass-strong: rgba(255, 255, 255, 0.72);
          font-family: "Inter", "IBM Plex Sans", system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
          background:
            linear-gradient(rgba(17, 17, 17, 0.035) 1px, transparent 1px),
            linear-gradient(90deg, rgba(17, 17, 17, 0.035) 1px, transparent 1px),
            radial-gradient(circle at 12% 10%, rgba(35, 123, 114, 0.1), transparent 28rem),
            var(--paper);
          background-size: 34px 34px, 34px 34px, auto, auto;
        }

        .v5-blueprint * {
          box-sizing: border-box;
        }

        .v5-shell {
          width: min(1180px, calc(100vw - 32px));
          margin: 0 auto;
        }

        .v5-hairline {
          position: relative;
          border: 1px solid var(--line);
          background: rgba(255, 255, 255, 0.34);
          box-shadow: 0 1px 0 rgba(255, 255, 255, 0.7) inset;
        }

        .v5-hairline::before,
        .v5-hairline::after {
          position: absolute;
          width: 10px;
          height: 10px;
          border-color: var(--line-strong);
          content: "";
          pointer-events: none;
        }

        .v5-hairline::before {
          left: 12px;
          top: 12px;
          border-left: 1px solid;
          border-top: 1px solid;
        }

        .v5-hairline::after {
          bottom: 12px;
          right: 12px;
          border-bottom: 1px solid;
          border-right: 1px solid;
        }

        .v5-title {
          font-family: "Playfair Display", "Georgia", serif;
          letter-spacing: 0;
        }

        .v5-glass {
          border: 1px solid rgba(17, 17, 17, 0.16);
          background: linear-gradient(145deg, rgba(255, 255, 255, 0.72), rgba(255, 255, 255, 0.24));
          box-shadow: 0 22px 70px rgba(24, 24, 19, 0.08), 0 1px 0 rgba(255, 255, 255, 0.85) inset;
          backdrop-filter: blur(18px);
        }

        .v5-model {
          position: relative;
          min-height: 520px;
          overflow: hidden;
          isolation: isolate;
        }

        .v5-model::before {
          position: absolute;
          inset: 24px;
          border: 1px dashed rgba(17, 17, 17, 0.18);
          content: "";
        }

        .v5-model::after {
          position: absolute;
          left: 10%;
          right: 10%;
          top: 50%;
          height: 1px;
          background: rgba(17, 17, 17, 0.24);
          content: "";
          transform: rotate(-18deg);
          transform-origin: center;
          z-index: -1;
        }

        .v5-layer {
          position: absolute;
          display: grid;
          gap: 12px;
          min-width: 188px;
          border: 1px solid rgba(17, 17, 17, 0.22);
          background: rgba(255, 255, 255, 0.48);
          padding: 16px;
          box-shadow: 0 18px 42px rgba(17, 17, 17, 0.08);
          backdrop-filter: blur(14px);
        }

        .v5-layer span {
          display: block;
          height: 7px;
          border: 1px solid rgba(17, 17, 17, 0.2);
          background: rgba(255, 255, 255, 0.42);
        }

        .v5-stamp {
          border: 1px solid rgba(35, 123, 114, 0.4);
          color: var(--accent);
          background: rgba(35, 123, 114, 0.08);
        }

        .v5-card {
          border: 1px solid var(--line);
          background: rgba(255, 255, 255, 0.5);
          box-shadow: 0 1px 0 rgba(255, 255, 255, 0.78) inset;
          backdrop-filter: blur(12px);
        }

        .v5-code {
          max-width: 100%;
          border: 1px solid rgba(17, 17, 17, 0.22);
          background:
            linear-gradient(rgba(255, 255, 255, 0.055) 1px, transparent 1px),
            #111111;
          background-size: 100% 28px;
          color: #f7f4ea;
          box-shadow: 0 20px 56px rgba(17, 17, 17, 0.14);
        }

        @media (max-width: 760px) {
          .v5-shell {
            width: min(100% - 24px, 1180px);
          }

          .v5-model {
            min-height: 420px;
          }

          .v5-model::before {
            inset: 14px;
          }

          .v5-layer {
            min-width: 142px;
            padding: 12px;
          }
        }
      `}</style>

      <section class="v5-shell grid gap-8 pb-14 pt-10 sm:pb-20 sm:pt-14 lg:grid-cols-[0.92fr_1.08fr] lg:items-center">
        <div class="max-w-[680px]">
          <p class="mb-4 inline-flex border border-[var(--line-strong)] bg-[rgba(255,255,255,0.38)] px-3 py-1 text-[0.68rem] font-semibold uppercase tracking-[0.18em] text-[var(--muted)]">
            Product blueprint / pre-code model
          </p>
          <h1 class="v5-title m-0 text-[clamp(3.25rem,9vw,7.25rem)] font-normal leading-[0.88] text-[var(--ink)]">
            Give your app a shape before it has code.
          </h1>
          <p class="mt-7 max-w-xl text-base leading-8 text-[var(--muted)] sm:text-lg">
            Specter turns early intent into a reviewable product drawing:
            screens, states, routes, and scenarios arranged before the first
            implementation choice starts to harden.
          </p>
          <div class="mt-8 flex flex-col gap-3 sm:flex-row">
            <a
              href="#api"
              class="inline-flex items-center justify-center border border-[var(--ink)] bg-[var(--ink)] px-5 py-3 text-sm font-semibold text-white no-underline transition hover:-translate-y-0.5 hover:text-white"
            >
              Inspect current API
            </a>
            <a
              href="/docs"
              class="inline-flex items-center justify-center border border-[var(--line-strong)] bg-[rgba(255,255,255,0.48)] px-5 py-3 text-sm font-semibold text-[var(--ink)] no-underline transition hover:-translate-y-0.5 hover:text-[var(--ink)]"
            >
              Read more
            </a>
          </div>
        </div>

        <div class="v5-hairline v5-model">
          <div class="v5-layer left-[8%] top-[9%] rotate-[-5deg]">
            <p class="m-0 text-[0.64rem] font-bold uppercase tracking-[0.18em] text-[var(--accent)]">
              Route
            </p>
            <span />
            <span class="w-4/5" />
            <span class="w-3/5" />
          </div>
          <div class="v5-layer right-[10%] top-[17%] rotate-[4deg]">
            <p class="m-0 text-[0.64rem] font-bold uppercase tracking-[0.18em] text-[var(--accent)]">
              State
            </p>
            <span class="w-3/5" />
            <span />
            <span class="w-2/3" />
          </div>
          <div class="v5-layer left-[19%] top-[40%] rotate-[2deg] bg-[rgba(35,123,114,0.08)]">
            <p class="m-0 text-[0.64rem] font-bold uppercase tracking-[0.18em] text-[var(--accent)]">
              Scenario
            </p>
            <span />
            <span class="w-1/2" />
          </div>
          <div class="v5-layer bottom-[13%] right-[15%] rotate-[-6deg]">
            <p class="m-0 text-[0.64rem] font-bold uppercase tracking-[0.18em] text-[var(--accent)]">
              Boundary
            </p>
            <span class="w-4/5" />
            <span />
            <span class="w-2/5" />
          </div>
          <div class="absolute left-[50%] top-[50%] h-24 w-24 -translate-x-1/2 -translate-y-1/2 border border-[rgba(17,17,17,0.34)] bg-[rgba(255,255,255,0.24)] backdrop-blur-md" />
          <div class="absolute left-[50%] top-[50%] h-14 w-14 -translate-x-1/2 -translate-y-1/2 border border-[rgba(35,123,114,0.48)] bg-[rgba(35,123,114,0.1)]" />
        </div>
      </section>

      <section class="border-y border-[var(--line)] bg-[rgba(255,255,255,0.22)]">
        <div class="v5-shell grid gap-4 py-10 md:grid-cols-3">
          <BlueprintStep
            label="01"
            title="Intent is drafted"
            copy="A product sentence becomes an outline of routes, objects, and ownership boundaries."
          />
          <BlueprintStep
            label="02"
            title="States get named"
            copy="Success, repair, empty, permission, and loading paths are placed on the drawing."
          />
          <BlueprintStep
            label="03"
            title="Build order appears"
            copy="The shape becomes clear enough for humans and agents to implement without wandering."
          />
        </div>
      </section>

      <section class="v5-shell grid gap-8 py-14 lg:grid-cols-[0.82fr_1.18fr] lg:items-start">
        <div class="v5-hairline p-5 sm:p-7">
          <p class="m-0 text-[0.68rem] font-bold uppercase tracking-[0.18em] text-[var(--accent)]">
            Why shape matters
          </p>
          <h2 class="v5-title m-0 mt-4 text-4xl font-normal leading-tight text-[var(--ink)] sm:text-5xl">
            A fast build still needs a measured drawing.
          </h2>
          <p class="mt-5 text-base leading-8 text-[var(--muted)]">
            Generation can move faster than agreement. Specter gives the team a
            calm surface for inspecting what the app is becoming before code
            turns guesses into architecture.
          </p>
        </div>
        <div class="grid gap-4 sm:grid-cols-2">
          <BlueprintCard
            title="Inspect before commit"
            copy="See the model before files, migrations, and workflows gather momentum."
          />
          <BlueprintCard
            title="Keep intent traceable"
            copy="Tie every screen and state back to the outcome it is supposed to support."
          />
          <BlueprintCard
            title="Expose missing states"
            copy="Surface recovery, permissions, loading, and quiet edge cases while they are cheap."
          />
          <BlueprintCard
            title="Guide implementation"
            copy="Give teammates and agents a durable outline for the order of the build."
          />
        </div>
      </section>

      <section id="api" class="v5-shell pb-16">
        <div class="v5-glass grid gap-7 p-4 sm:p-7 lg:grid-cols-[0.82fr_1.18fr]">
          <div class="flex min-w-0 flex-col justify-between gap-8">
            <div>
              <p class="m-0 text-[0.68rem] font-bold uppercase tracking-[0.18em] text-[var(--accent)]">
                Current createCommandSpec
              </p>
              <h2 class="v5-title m-0 mt-4 text-4xl font-normal leading-tight text-[var(--ink)] sm:text-5xl">
                The outline stays small enough to read.
              </h2>
              <p class="mt-5 text-base leading-8 text-[var(--muted)]">
                A plain command, a pinned scenario, and one decision path make
                the product shape inspectable before full implementation.
              </p>
            </div>
            <div class="v5-stamp w-fit px-4 py-2 text-xs font-bold uppercase tracking-[0.16em]">
              Reviewable before code
            </div>
          </div>
          <pre class="v5-code m-0 overflow-x-auto p-4 text-[0.78rem] leading-7 sm:p-5 sm:text-sm"><code>{`export const upgradePlanSliceRegistration =
  createCommandSpec('upgradePlan')
    .schema(z.object({
      workspaceId: z.string(),
      plan: z.enum(['pro', 'team']),
    }))
    .scenarios({
      given: [],
      when: { workspaceId: 'ws_1', plan: 'team' },
      expect: [
        planUpgradedEvent.create({
          workspaceId: 'ws_1',
          plan: 'team',
        }),
      ],
    })
    .decide((command) => [
      planUpgradedEvent.create(command),
    ])`}</code></pre>
        </div>
      </section>

      <section class="v5-shell pb-20">
        <div class="v5-hairline grid gap-6 bg-[rgba(255,255,255,0.34)] p-5 sm:p-7 md:grid-cols-[1fr_auto] md:items-end">
          <div>
            <p class="m-0 text-[0.68rem] font-bold uppercase tracking-[0.18em] text-[var(--accent)]">
              Specter
            </p>
            <h2 class="v5-title m-0 mt-3 max-w-3xl text-4xl font-normal leading-tight text-[var(--ink)] sm:text-5xl">
              Let the app take shape before the sprint takes over.
            </h2>
          </div>
          <a
            href="/docs"
            class="inline-flex items-center justify-center border border-[var(--ink)] bg-[var(--ink)] px-5 py-3 text-sm font-semibold text-white no-underline transition hover:-translate-y-0.5 hover:text-white"
          >
            Read more
          </a>
        </div>
      </section>
    </main>
  )
}

function BlueprintStep(props: { label: string; title: string; copy: string }) {
  return (
    <article class="v5-card min-w-0 p-5">
      <div class="flex items-center gap-3">
        <span class="h-px flex-1 bg-[var(--line-strong)]" />
        <span class="text-[0.68rem] font-bold uppercase tracking-[0.18em] text-[var(--accent)]">
          {props.label}
        </span>
      </div>
      <h3 class="m-0 mt-5 text-xl font-semibold tracking-[0] text-[var(--ink)]">
        {props.title}
      </h3>
      <p class="m-0 mt-3 text-sm leading-7 text-[var(--muted)]">
        {props.copy}
      </p>
    </article>
  )
}

function BlueprintCard(props: { title: string; copy: string }) {
  return (
    <article class="v5-card min-w-0 p-5">
      <div class="mb-5 grid grid-cols-[1fr_16px] items-center gap-3">
        <span class="h-px bg-[var(--line)]" />
        <span class="h-4 w-4 border border-[var(--accent)] bg-[var(--accent-soft)]" />
      </div>
      <h3 class="m-0 text-lg font-semibold tracking-[0] text-[var(--ink)]">
        {props.title}
      </h3>
      <p class="m-0 mt-3 text-sm leading-7 text-[var(--muted)]">
        {props.copy}
      </p>
    </article>
  )
}
