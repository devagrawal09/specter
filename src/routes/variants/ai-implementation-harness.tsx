import { createFileRoute } from '@tanstack/solid-router'

export const Route = createFileRoute('/variants/ai-implementation-harness')({
  component: AiImplementationHarness,
})

function AiImplementationHarness() {
  return (
    <main class="specter-ai-terminal min-h-screen overflow-hidden px-4 py-8 text-[#e9fff0] sm:px-6 sm:py-12">
      <style>
        {`
          .specter-ai-terminal {
            --term-bg: #090b0a;
            --term-panel: rgba(15, 18, 16, 0.91);
            --term-panel-2: rgba(22, 24, 21, 0.88);
            --term-line: rgba(107, 255, 144, 0.22);
            --term-line-amber: rgba(255, 190, 82, 0.32);
            --term-green: #6dff93;
            --term-green-soft: #b8ffc9;
            --term-amber: #ffbe52;
            --term-muted: #9aad9f;
            --term-red: #ff6b6b;
            background:
              radial-gradient(circle at 14% 10%, rgba(109, 255, 147, 0.15), transparent 31rem),
              radial-gradient(circle at 90% 4%, rgba(255, 190, 82, 0.13), transparent 26rem),
              linear-gradient(180deg, #111411 0%, var(--term-bg) 46%, #050605 100%);
            font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace;
          }

          .specter-ai-terminal * {
            box-sizing: border-box;
          }

          .specter-ai-terminal::before {
            content: "";
            position: fixed;
            inset: 0;
            pointer-events: none;
            background:
              linear-gradient(rgba(255, 255, 255, 0.035) 1px, transparent 1px),
              linear-gradient(90deg, rgba(255, 255, 255, 0.025) 1px, transparent 1px);
            background-size: 48px 48px;
            mask-image: linear-gradient(to bottom, black, transparent 78%);
          }

          .specter-console-shell {
            position: relative;
            width: min(1180px, 100%);
            margin: 0 auto;
            border: 1px solid rgba(109, 255, 147, 0.26);
            background: linear-gradient(135deg, rgba(11, 13, 12, 0.96), rgba(24, 25, 22, 0.91));
            box-shadow:
              0 0 0 1px rgba(255, 190, 82, 0.08) inset,
              0 28px 80px rgba(0, 0, 0, 0.44),
              0 0 42px rgba(109, 255, 147, 0.1);
          }

          .specter-console-shell::after {
            content: "";
            position: absolute;
            inset: 0;
            pointer-events: none;
            background: repeating-linear-gradient(
              180deg,
              rgba(255, 255, 255, 0.025) 0,
              rgba(255, 255, 255, 0.025) 1px,
              transparent 1px,
              transparent 5px
            );
            opacity: 0.36;
            mix-blend-mode: screen;
          }

          .specter-terminal-bar {
            display: flex;
            min-width: 0;
            align-items: center;
            justify-content: space-between;
            gap: 1rem;
            border-bottom: 1px solid rgba(109, 255, 147, 0.2);
            background: rgba(7, 9, 8, 0.82);
            color: var(--term-muted);
          }

          .specter-terminal-dots {
            display: flex;
            flex: 0 0 auto;
            gap: 0.45rem;
          }

          .specter-terminal-dots span {
            width: 0.68rem;
            height: 0.68rem;
            border-radius: 999px;
            background: var(--term-green);
            box-shadow: 0 0 14px rgba(109, 255, 147, 0.72);
          }

          .specter-terminal-dots span:nth-child(2) {
            background: var(--term-amber);
            box-shadow: 0 0 14px rgba(255, 190, 82, 0.66);
          }

          .specter-terminal-dots span:nth-child(3) {
            background: #59655d;
            box-shadow: none;
          }

          .specter-panel {
            border: 1px solid var(--term-line);
            background: var(--term-panel);
            box-shadow: 0 0 0 1px rgba(255, 255, 255, 0.025) inset;
          }

          .specter-panel-amber {
            border-color: var(--term-line-amber);
            background: var(--term-panel-2);
          }

          .specter-terminal-title {
            color: var(--term-green);
            text-shadow: 0 0 18px rgba(109, 255, 147, 0.26);
            letter-spacing: 0;
          }

          .specter-kicker {
            color: var(--term-amber);
            letter-spacing: 0.16em;
            text-transform: uppercase;
          }

          .specter-copy {
            color: #c5d8c9;
          }

          .specter-log-line {
            display: grid;
            grid-template-columns: 5.75rem minmax(0, 1fr);
            gap: 0.8rem;
            min-width: 0;
            border-bottom: 1px solid rgba(109, 255, 147, 0.13);
            padding: 0.82rem 0;
          }

          .specter-log-line:last-child {
            border-bottom: 0;
          }

          .specter-log-time {
            color: var(--term-amber);
          }

          .specter-log-copy {
            min-width: 0;
            color: var(--term-green-soft);
            overflow-wrap: anywhere;
          }

          .specter-loop-step {
            display: grid;
            grid-template-columns: minmax(6.75rem, 0.35fr) minmax(0, 1fr);
            gap: 1rem;
            min-width: 0;
            border: 1px solid rgba(109, 255, 147, 0.2);
            background: rgba(7, 10, 8, 0.62);
            padding: 0.95rem;
          }

          .specter-loop-label {
            color: var(--term-amber);
          }

          .specter-loop-copy {
            min-width: 0;
            color: #c5d8c9;
          }

          .specter-code-window pre {
            max-width: 100%;
            overflow-x: auto;
            scrollbar-color: rgba(109, 255, 147, 0.52) rgba(255, 255, 255, 0.06);
          }

          .specter-command {
            border: 1px solid rgba(109, 255, 147, 0.27);
            background: linear-gradient(180deg, rgba(109, 255, 147, 0.13), rgba(109, 255, 147, 0.05));
            color: var(--term-green);
            box-shadow: 0 0 22px rgba(109, 255, 147, 0.13);
          }

          .specter-command-secondary {
            border: 1px solid rgba(255, 190, 82, 0.34);
            background: rgba(255, 190, 82, 0.07);
            color: #ffe2ad;
          }

          @media (max-width: 640px) {
            .specter-ai-terminal {
              padding-left: 0.85rem;
              padding-right: 0.85rem;
            }

            .specter-terminal-bar {
              align-items: flex-start;
              flex-direction: column;
            }

            .specter-log-line,
            .specter-loop-step {
              grid-template-columns: 1fr;
              gap: 0.35rem;
            }

            .specter-command,
            .specter-command-secondary {
              width: 100%;
              max-width: 100%;
              flex-wrap: wrap;
              gap: 0.45rem;
              text-align: center;
            }

            .specter-command span {
              margin-left: 0;
            }
          }
        `}
      </style>

      <section class="specter-console-shell rounded-lg">
        <div class="specter-terminal-bar rounded-t-lg px-4 py-3 text-xs sm:px-5">
          <div class="specter-terminal-dots" aria-hidden="true">
            <span />
            <span />
            <span />
          </div>
          <div class="min-w-0 truncate">specter://implementation-harness/live-run</div>
          <div class="text-[#6dff93]">trace: armed</div>
        </div>

        <div class="relative z-10 grid gap-6 p-4 sm:p-6 lg:grid-cols-[1.02fr_0.98fr] lg:p-8">
          <div class="specter-panel rounded-lg p-5 sm:p-7">
            <p class="specter-kicker mb-4 text-xs font-bold">
              Specter implementation harness
            </p>
            <h1 class="specter-terminal-title text-4xl font-black leading-[1.03] sm:text-5xl lg:text-6xl">
              Give AI something real to build against.
            </h1>
            <p class="specter-copy mt-6 max-w-2xl text-base leading-8 sm:text-lg">
              Specter turns product intent into executable slices: typed
              commands, explicit scenarios, implementation hooks, and
              verification pressure that keeps generated code honest.
            </p>
            <div class="mt-7 grid gap-2 rounded-md border border-[rgba(109,255,147,0.18)] bg-black/35 px-4 py-3 text-sm">
              <TraceLine time="00:00" copy="$ specter run addTodoSlice --watch" />
              <TraceLine time="00:01" copy="prompt loaded: behavior first, code second" />
              <TraceLine time="00:03" copy="verification harness waiting for generated code" />
            </div>
            <div class="mt-7 flex flex-col gap-3 sm:flex-row">
              <button
                type="button"
                disabled
                class="specter-command inline-flex min-h-12 cursor-not-allowed items-center justify-center rounded-md px-5 text-sm font-bold opacity-80"
              >
                Get started
                <span class="ml-2 rounded-sm border border-[rgba(109,255,147,0.28)] bg-black/30 px-2 py-0.5 text-[0.68rem] uppercase tracking-[0.14em]">
                  Coming soon
                </span>
              </button>
              <a
                href="/docs"
                class="specter-command-secondary inline-flex min-h-12 items-center justify-center rounded-md px-5 text-sm font-bold no-underline hover:text-[#fff0ce]"
              >
                Read more
              </a>
            </div>
          </div>

          <div class="specter-panel specter-panel-amber rounded-lg p-4 sm:p-5">
            <div class="mb-4 flex min-w-0 flex-col gap-3 border-b border-[rgba(255,190,82,0.2)] pb-4 sm:flex-row sm:items-center sm:justify-between">
              <span class="specter-kicker text-xs font-bold">Harness loop</span>
              <span class="w-fit rounded-sm border border-[rgba(109,255,147,0.24)] bg-black/35 px-3 py-1 text-xs font-semibold text-[#6dff93]">
                scenario-led
              </span>
            </div>
            <div class="grid gap-3">
              <LoopStep label="Human" copy="Names the behavior worth shipping." />
              <LoopStep label="Spec" copy="Defines the command boundary." />
              <LoopStep label="Scenario" copy="Pins the examples and edge cases." />
              <LoopStep label="Implementation" copy="Lets code satisfy the contract." />
              <LoopStep label="Verification" copy="Runs the slice until intent survives." />
            </div>
          </div>
        </div>
      </section>

      <section class="mx-auto mt-6 grid w-[min(1180px,100%)] gap-4 lg:grid-cols-3">
        <ProblemCard
          code="WARN"
          title="Vibe-built apps drift"
          copy="A prompt can produce motion without memory. The next edit can erase the product rule that made the first answer work."
        />
        <ProblemCard
          code="MISS"
          title="Specs get stranded"
          copy="Documents explain intent, but they rarely stand between an implementation and a regression."
        />
        <ProblemCard
          code="LATE"
          title="Tests arrive late"
          copy="When verification is bolted on after code generation, it mostly describes what happened instead of what should happen."
        />
      </section>

      <section class="mx-auto mt-6 grid w-[min(1180px,100%)] gap-6 lg:grid-cols-[0.88fr_1.12fr]">
        <div class="specter-panel rounded-lg p-5 sm:p-7">
          <p class="specter-kicker mb-3 text-xs font-bold">Why slices matter</p>
          <h2 class="text-2xl font-black leading-tight text-[#e9fff0] sm:text-3xl">
            A slice is small enough for AI and strict enough for production.
          </h2>
          <p class="specter-copy mt-4 text-base leading-8">
            Specter gives each feature a narrow executable surface. Commands
            say what can happen, scenarios say what must be preserved, and the
            implementation has a compact target to satisfy without inventing the
            whole application at once.
          </p>
          <div class="mt-6 grid gap-3 text-sm font-semibold">
            <div class="rounded-md border border-[rgba(109,255,147,0.18)] bg-black/30 p-4 text-[#b8ffc9]">
              Narrow context for generation
            </div>
            <div class="rounded-md border border-[rgba(255,190,82,0.26)] bg-black/30 p-4 text-[#ffe2ad]">
              Serializable behavior examples
            </div>
            <div class="rounded-md border border-[rgba(109,255,147,0.18)] bg-black/30 p-4 text-[#b8ffc9]">
              Repeatable checks before the next change
            </div>
          </div>
        </div>

        <div class="specter-panel specter-code-window rounded-lg p-4 sm:p-5">
          <div class="mb-4 flex min-w-0 flex-col gap-2 border-b border-[rgba(109,255,147,0.18)] pb-4 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <p class="specter-kicker mb-2 text-xs font-bold">Current API proof</p>
              <h2 class="text-2xl font-black text-[#e9fff0] sm:text-3xl">
                The contract is already code.
              </h2>
            </div>
            <span class="w-fit text-xs font-bold text-[#6dff93]">verify.pass</span>
          </div>
          <pre class="rounded-md border border-[rgba(109,255,147,0.2)] bg-[#050705] p-4 text-[0.78rem] leading-6 text-[#dfffe8] shadow-inner sm:text-sm">
            <code class="border-0 bg-transparent p-0 text-inherit">
{`export const addTodoSlice = createCommandSpec('addTodo')
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

    if (!title) {
      return [errorEvent.create({
        message: 'Todo title is required',
      })]
    }

    return [todoAddedEvent.create({
      todoId: crypto.randomUUID(),
      title,
    })]
  })`}
            </code>
          </pre>
        </div>
      </section>

      <section class="specter-panel specter-panel-amber mx-auto mt-6 w-[min(1180px,100%)] rounded-lg p-5 sm:p-7">
        <div class="grid gap-6 lg:grid-cols-[1fr_auto] lg:items-center">
          <div>
            <p class="specter-kicker mb-3 text-xs font-bold">
              Compiler-lab workflow
            </p>
            <h2 class="text-2xl font-black leading-tight text-[#e9fff0] sm:text-3xl">
              Keep the experiment fast. Keep the harness real.
            </h2>
            <p class="specter-copy mt-4 max-w-3xl text-base leading-8">
              The goal is not to hide engineering behind a builder. It is to
              make the implementation target sharper so humans and AI can trade
              work without losing the thread.
            </p>
          </div>
          <div class="flex flex-col gap-3 sm:flex-row lg:flex-col">
            <button
              type="button"
              disabled
              class="specter-command inline-flex min-h-12 cursor-not-allowed items-center justify-center rounded-md px-5 text-sm font-bold opacity-80"
            >
              Get started
              <span class="ml-2 rounded-sm border border-[rgba(109,255,147,0.28)] bg-black/30 px-2 py-0.5 text-[0.68rem] uppercase tracking-[0.14em]">
                Coming soon
              </span>
            </button>
            <a
              href="/docs"
              class="specter-command-secondary inline-flex min-h-12 items-center justify-center rounded-md px-5 text-sm font-bold no-underline hover:text-[#fff0ce]"
            >
              Read more
            </a>
          </div>
        </div>
      </section>
    </main>
  )
}

function TraceLine(props: { time: string; copy: string }) {
  return (
    <div class="specter-log-line">
      <div class="specter-log-time text-xs font-bold">{props.time}</div>
      <div class="specter-log-copy text-xs sm:text-sm">{props.copy}</div>
    </div>
  )
}

function LoopStep(props: { label: string; copy: string }) {
  return (
    <div class="specter-loop-step rounded-md">
      <div class="specter-loop-label text-sm font-extrabold">{props.label}</div>
      <div class="specter-loop-copy text-sm leading-6">{props.copy}</div>
    </div>
  )
}

function ProblemCard(props: { code: string; title: string; copy: string }) {
  return (
    <article class="specter-panel rounded-lg p-5">
      <div class="mb-4 flex items-center justify-between gap-3 border-b border-[rgba(109,255,147,0.15)] pb-3">
        <span class="text-xs font-black text-[#ffbe52]">[{props.code}]</span>
        <span class="h-2 w-2 rounded-full bg-[#6dff93] shadow-[0_0_14px_rgba(109,255,147,0.8)]" />
      </div>
      <h2 class="text-lg font-extrabold leading-tight text-[#e9fff0]">
        {props.title}
      </h2>
      <p class="specter-copy mt-3 text-sm leading-7">{props.copy}</p>
    </article>
  )
}
