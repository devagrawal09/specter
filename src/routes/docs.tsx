import { createFileRoute } from '@tanstack/solid-router'

export const Route = createFileRoute('/docs')({
  component: Docs,
})

function Docs() {
  return (
    <main class="page-wrap px-4 py-10 sm:py-14">
      <section class="island-shell rounded-2xl p-6 sm:p-8 lg:p-10">
        <p class="island-kicker mb-3">Prelim docs</p>
        <h1 class="display-title m-0 max-w-4xl text-5xl font-bold leading-[1.02] text-[var(--sea-ink)] sm:text-6xl">
          Specter authoring model
        </h1>
        <p class="mt-5 max-w-3xl text-lg leading-8 text-[var(--sea-ink-soft)]">
          Specter models an app as explicit vertical slices. A slice declares
          schemas, scenarios, implementation hooks, and the runtime wiring that
          lets tests and app code share the same contract.
        </p>
      </section>

      <section class="mt-8 grid gap-4 lg:grid-cols-3">
        <DocCard
          title="Specs"
          body="Use current builder APIs like createCommandSpec, createProjectionSpec, and createReactionSpec to define behavior close to the slice."
        />
        <DocCard
          title="Scenarios"
          body="Given, when, and expect cases are not separate test prose. They are executable fixtures collected by shared scenario runners."
        />
        <DocCard
          title="Harness"
          body="The registry gathers commands, projections, reactions, schemas, and apply handlers so implementation can run against explicit contracts."
        />
      </section>

      <section class="mt-8 rounded-2xl border border-[var(--line)] bg-[var(--sea-ink)] p-6 text-white sm:p-8">
        <p class="m-0 text-xs font-bold uppercase tracking-[0.16em] text-[#a9e3dc]">
          Current API sketch
        </p>
        <pre class="mt-5 overflow-x-auto rounded-xl border border-white/10 bg-white/[0.06] p-5 text-sm leading-7 text-[#e8fff5]"><code>{`export const addTodoSliceRegistration =
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
      </section>
    </main>
  )
}

function DocCard(props: { title: string; body: string }) {
  return (
    <article class="feature-card rounded-2xl border border-[var(--line)] p-5">
      <h2 class="m-0 text-2xl font-extrabold text-[var(--sea-ink)]">
        {props.title}
      </h2>
      <p class="mb-0 mt-3 text-sm leading-7 text-[var(--sea-ink-soft)]">
        {props.body}
      </p>
    </article>
  )
}
