import { createFileRoute } from '@tanstack/solid-router'

export const Route = createFileRoute('/variants/spec-test-harness')({
  component: SpecTestHarnessVariant,
})

const scenarioRows = [
  {
    slice: 'Commands',
    scenario: 'Add todo trims input before it enters the model',
    signal: 'PASS',
    proof: 'todoAdded.title === "Ship it"',
  },
  {
    slice: 'Commands',
    scenario: 'Empty title rejects without mutating state',
    signal: 'FAIL PATH',
    proof: 'errorEvent emitted',
  },
  {
    slice: 'Reactions',
    scenario: 'Fifth completed todo creates celebration intent',
    signal: 'PASS',
    proof: 'createTodoCheer queued',
  },
  {
    slice: 'Projection',
    scenario: 'Removed todo leaves no row in active list',
    signal: 'WATCH',
    proof: 'visibleTodos excludes id',
  },
]

function SpecTestHarnessVariant() {
  return (
    <main class="v6-lab min-h-screen overflow-x-hidden bg-[#07100f] text-[#f5fff8]">
      <style>{`
        .v6-lab {
          --v6-panel: rgba(13, 23, 22, 0.92);
          --v6-panel-strong: #101a18;
          --v6-rail: rgba(221, 255, 238, 0.13);
          --v6-line: rgba(202, 255, 222, 0.2);
          --v6-text-soft: #b9c9c0;
          --v6-green: #38f08c;
          --v6-red: #ff4b5f;
          --v6-yellow: #ffd34f;
          background:
            radial-gradient(circle at 18% 8%, rgba(56, 240, 140, 0.18), transparent 28rem),
            radial-gradient(circle at 92% 18%, rgba(255, 75, 95, 0.13), transparent 24rem),
            linear-gradient(135deg, #050908 0%, #0a1714 44%, #11110c 100%);
        }

        .v6-lab * {
          box-sizing: border-box;
        }

        .v6-lab-grid {
          background-image:
            linear-gradient(rgba(202, 255, 222, 0.055) 1px, transparent 1px),
            linear-gradient(90deg, rgba(202, 255, 222, 0.055) 1px, transparent 1px);
          background-size: 34px 34px;
        }

        .v6-lab-panel {
          border: 1px solid var(--v6-line);
          background:
            linear-gradient(180deg, rgba(255, 255, 255, 0.055), transparent 34%),
            var(--v6-panel);
          box-shadow: 0 22px 60px rgba(0, 0, 0, 0.3);
        }

        .v6-lab-led {
          box-shadow: 0 0 0 4px rgba(56, 240, 140, 0.08), 0 0 24px rgba(56, 240, 140, 0.42);
        }

        .v6-lab-pre {
          scrollbar-color: rgba(56, 240, 140, 0.55) rgba(255, 255, 255, 0.06);
        }

        @media (max-width: 640px) {
          .v6-lab-matrix {
            grid-template-columns: minmax(0, 1fr);
          }
        }
      `}</style>

      <div class="v6-lab-grid px-4 py-6 sm:px-6 lg:px-8">
        <section class="mx-auto grid w-full max-w-7xl gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(340px,0.86fr)] lg:items-stretch">
          <div class="v6-lab-panel rounded-lg p-5 sm:p-7 lg:p-8">
            <div class="flex flex-wrap items-center gap-2">
              <span class="rounded-full border border-[#38f08c]/35 bg-[#38f08c]/12 px-3 py-1 text-xs font-black uppercase tracking-[0.18em] text-[#8effbd]">
                Variant 6
              </span>
              <span class="rounded-full border border-[#ffd34f]/35 bg-[#ffd34f]/10 px-3 py-1 text-xs font-black uppercase tracking-[0.18em] text-[#ffe28a]">
                Verification dashboard
              </span>
            </div>

            <h1 class="m-0 mt-5 max-w-4xl text-[clamp(2.4rem,7vw,6.6rem)] font-black leading-[0.88] tracking-normal text-white">
              Write the specification. Get the test harness.
            </h1>

            <p class="m-0 mt-6 max-w-3xl text-base leading-8 text-[var(--v6-text-soft)] sm:text-lg">
              Specter treats each app slice as a lab subject: commands,
              reactions, projections, and UI promises are isolated, stimulated,
              and verified with proof the team can read before the product
              depends on it.
            </p>

            <div class="mt-7 grid gap-3 sm:grid-cols-3">
              <MetricBadge value="42" label="slice scenarios" tone="green" />
              <MetricBadge value="98%" label="confidence" tone="yellow" />
              <MetricBadge value="0" label="silent regressions" tone="red" />
            </div>
          </div>

          <aside class="v6-lab-panel rounded-lg p-4 sm:p-5">
            <div class="flex items-start justify-between gap-4 border-b border-white/10 pb-4">
              <div>
                <p class="m-0 text-xs font-black uppercase tracking-[0.18em] text-[#8effbd]">
                  Active run
                </p>
                <h2 class="m-0 mt-2 text-xl font-black text-white">
                  Todo app slice / completion cheer
                </h2>
              </div>
              <span class="v6-lab-led mt-1 h-3 w-3 shrink-0 rounded-full bg-[var(--v6-green)]" />
            </div>

            <div class="mt-4 grid gap-3">
              <HarnessStep label="Given" value="4 completed todos" status="SEEDED" tone="yellow" />
              <HarnessStep label="When" value="todoCompletionChanged" status="OBSERVED" tone="green" />
              <HarnessStep label="Expect" value="no cheer command" status="PASS" tone="green" />
              <HarnessStep label="Given" value="5 completed todos" status="SEEDED" tone="yellow" />
              <HarnessStep label="Expect" value="createTodoCheer" status="PASS" tone="green" />
            </div>
          </aside>
        </section>

        <section class="mx-auto mt-5 grid w-full max-w-7xl gap-5 lg:grid-cols-[minmax(0,0.95fr)_minmax(0,1.05fr)]">
          <div class="v6-lab-panel rounded-lg p-5 sm:p-6">
            <div class="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <p class="m-0 text-xs font-black uppercase tracking-[0.18em] text-[#ffe28a]">
                  Scenario matrix
                </p>
                <h2 class="m-0 mt-2 text-3xl font-black text-white">
                  App behavior under proof.
                </h2>
              </div>
              <span class="w-fit rounded-full border border-white/15 bg-white/[0.08] px-3 py-1 text-xs font-black text-[#dceee4]">
                command | reaction | projection | UI
              </span>
            </div>

            <div class="v6-lab-matrix mt-5 grid grid-cols-[minmax(0,1fr)] gap-3">
              {scenarioRows.map((row) => (
                <ScenarioRow {...row} />
              ))}
            </div>
          </div>

          <div class="v6-lab-panel rounded-lg p-5 sm:p-6">
            <p class="m-0 text-xs font-black uppercase tracking-[0.18em] text-[#ff8793]">
              Current API
            </p>
            <div class="mt-2 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <h2 class="m-0 max-w-xl text-3xl font-black text-white">
                The spec is the fixture, oracle, and build brief.
              </h2>
              <span class="w-fit rounded-full border border-[#38f08c]/30 bg-[#38f08c]/10 px-3 py-1 text-xs font-black text-[#8effbd]">
                createCommandSpec
              </span>
            </div>

            <pre class="v6-lab-pre mt-5 max-w-full overflow-x-auto rounded-md border border-white/12 bg-[#020504] p-4 text-sm leading-6 text-[#dfffea]"><code>{`export const addTodoSliceRegistration =
  createCommandSpec('addTodo')
    .schema(z.object({ title: z.string() }))
    .scenarios(
      {
        given: [],
        when: { title: '  Ship it  ' },
        expect: [
          todoAddedEvent.create({
            todoId: 'generated',
            title: 'Ship it',
          }),
        ],
      },
      {
        given: [],
        when: { title: '   ' },
        expect: [
          errorEvent.create({
            message: 'Todo title is required',
          }),
        ],
      },
    )
    .decide((command) => {
      const title = command.title.trim()

      return title
        ? [
            todoAddedEvent.create({
              todoId: crypto.randomUUID(),
              title,
            }),
          ]
        : [
            errorEvent.create({
              message: 'Todo title is required',
            }),
          ]
    })`}</code></pre>
          </div>
        </section>

        <section class="mx-auto mt-5 w-full max-w-7xl">
          <div class="v6-lab-panel rounded-lg p-5 sm:p-6">
            <div class="grid gap-4 lg:grid-cols-[0.75fr_1.25fr] lg:items-center">
              <div>
                <p class="m-0 text-xs font-black uppercase tracking-[0.18em] text-[#8effbd]">
                  Proof surface
                </p>
                <h2 class="m-0 mt-2 text-3xl font-black text-white">
                  Broader than tests.
                </h2>
                <p class="m-0 mt-3 text-sm leading-7 text-[var(--v6-text-soft)]">
                  The harness becomes a living map of product slices, showing
                  what the app accepts, emits, remembers, and renders after each
                  verified behavior.
                </p>
              </div>

              <div class="grid gap-3 sm:grid-cols-3">
                <InstrumentCard label="Input integrity" readout="schema locked" tone="green" />
                <InstrumentCard label="Outcome trust" readout="expectations pinned" tone="yellow" />
                <InstrumentCard label="Regression risk" readout="visible fast" tone="red" />
              </div>
            </div>
          </div>
        </section>
      </div>
    </main>
  )
}

function MetricBadge(props: {
  value: string
  label: string
  tone: 'green' | 'yellow' | 'red'
}) {
  const toneClass =
    props.tone === 'green'
      ? 'border-[#38f08c]/35 bg-[#38f08c]/10 text-[#8effbd]'
      : props.tone === 'yellow'
        ? 'border-[#ffd34f]/35 bg-[#ffd34f]/10 text-[#ffe28a]'
        : 'border-[#ff4b5f]/35 bg-[#ff4b5f]/10 text-[#ff9da7]'

  return (
    <div class={`rounded-md border p-4 ${toneClass}`}>
      <strong class="block text-3xl font-black leading-none">{props.value}</strong>
      <span class="mt-2 block text-xs font-black uppercase tracking-[0.14em]">
        {props.label}
      </span>
    </div>
  )
}

function HarnessStep(props: {
  label: string
  value: string
  status: string
  tone: 'green' | 'yellow'
}) {
  const statusClass =
    props.tone === 'green'
      ? 'bg-[#38f08c] text-[#04100a]'
      : 'bg-[#ffd34f] text-[#171202]'

  return (
    <div class="grid min-w-0 gap-2 rounded-md border border-white/12 bg-white/[0.055] p-3 sm:grid-cols-[5rem_minmax(0,1fr)_auto] sm:items-center">
      <span class="text-xs font-black uppercase tracking-[0.15em] text-[#a8b8af]">
        {props.label}
      </span>
      <span class="min-w-0 overflow-hidden text-ellipsis text-sm font-bold text-white">
        {props.value}
      </span>
      <span class={`w-fit rounded px-2 py-1 text-[0.68rem] font-black ${statusClass}`}>
        {props.status}
      </span>
    </div>
  )
}

function ScenarioRow(props: {
  slice: string
  scenario: string
  signal: string
  proof: string
}) {
  const signalClass =
    props.signal === 'PASS'
      ? 'bg-[#38f08c] text-[#031009]'
      : props.signal === 'WATCH'
        ? 'bg-[#ffd34f] text-[#171202]'
        : 'bg-[#ff4b5f] text-white'

  return (
    <article class="grid min-w-0 gap-3 rounded-md border border-white/12 bg-[#050b0a]/70 p-3 sm:grid-cols-[7rem_minmax(0,1fr)]">
      <div>
        <span class="block text-xs font-black uppercase tracking-[0.15em] text-[#8effbd]">
          {props.slice}
        </span>
        <span class={`mt-3 inline-flex rounded px-2 py-1 text-[0.68rem] font-black ${signalClass}`}>
          {props.signal}
        </span>
      </div>
      <div class="min-w-0">
        <h3 class="m-0 text-base font-black leading-6 text-white">
          {props.scenario}
        </h3>
        <p class="m-0 mt-2 break-words font-mono text-xs leading-5 text-[#c5d8ce]">
          proof: {props.proof}
        </p>
      </div>
    </article>
  )
}

function InstrumentCard(props: {
  label: string
  readout: string
  tone: 'green' | 'yellow' | 'red'
}) {
  const color =
    props.tone === 'green'
      ? 'bg-[#38f08c]'
      : props.tone === 'yellow'
        ? 'bg-[#ffd34f]'
        : 'bg-[#ff4b5f]'

  return (
    <article class="rounded-md border border-white/12 bg-white/[0.055] p-4">
      <span class={`block h-2 w-12 rounded-full ${color}`} />
      <h3 class="m-0 mt-4 text-sm font-black uppercase tracking-[0.12em] text-white">
        {props.label}
      </h3>
      <p class="m-0 mt-2 text-sm leading-6 text-[var(--v6-text-soft)]">
        {props.readout}
      </p>
    </article>
  )
}
