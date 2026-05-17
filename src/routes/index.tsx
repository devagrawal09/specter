import { createFileRoute, useRouter } from '@tanstack/solid-router'
import { useServerFn } from '@tanstack/solid-start'
import { createSignal, For, Show } from 'solid-js'

import { createNote, listNotes } from '../server/notes.functions'

export const Route = createFileRoute('/')({
  loader: () => listNotes(),
  component: App,
})

function App() {
  const router = useRouter()
  const notes = Route.useLoaderData()
  const createNoteFn = useServerFn(createNote)
  const [title, setTitle] = createSignal('')
  const [body, setBody] = createSignal('')
  const [isSaving, setIsSaving] = createSignal(false)
  const [error, setError] = createSignal('')

  return (
    <main class="page-wrap px-4 pb-8 pt-14">
      <section class="island-shell rise-in relative overflow-hidden rounded-[2rem] px-6 py-10 sm:px-10 sm:py-14">
        <div class="pointer-events-none absolute -left-20 -top-24 h-56 w-56 rounded-full bg-[radial-gradient(circle,rgba(79,184,178,0.32),transparent_66%)]" />
        <div class="pointer-events-none absolute -bottom-20 -right-20 h-56 w-56 rounded-full bg-[radial-gradient(circle,rgba(47,106,74,0.18),transparent_66%)]" />
        <p class="island-kicker mb-3">TanStack Start Base Template</p>
        <h1 class="display-title mb-5 max-w-3xl text-4xl leading-[1.02] font-bold tracking-tight text-[var(--sea-ink)] sm:text-6xl">
          Start simple, ship quickly.
        </h1>
        <p class="mb-8 max-w-2xl text-base text-[var(--sea-ink-soft)] sm:text-lg">
          This base starter intentionally keeps things light: two routes, clean
          structure, and the essentials you need to build from scratch.
        </p>
        <div class="flex flex-wrap gap-3">
          <a
            href="/about"
            class="rounded-full border border-[rgba(50,143,151,0.3)] bg-[rgba(79,184,178,0.14)] px-5 py-2.5 text-sm font-semibold text-[var(--lagoon-deep)] no-underline transition hover:-translate-y-0.5 hover:bg-[rgba(79,184,178,0.24)]"
          >
            About This Starter
          </a>
          <a
            href="https://tanstack.com/router"
            target="_blank"
            rel="noopener noreferrer"
            class="rounded-full border border-[rgba(23,58,64,0.2)] bg-white/50 px-5 py-2.5 text-sm font-semibold text-[var(--sea-ink)] no-underline transition hover:-translate-y-0.5 hover:border-[rgba(23,58,64,0.35)]"
          >
            Router Guide
          </a>
        </div>
      </section>

      <section class="island-shell mt-8 rounded-2xl p-6">
        <div class="mb-5 flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p class="island-kicker mb-2">SQLite Persistence</p>
            <h2 class="m-0 text-xl font-semibold text-[var(--sea-ink)]">
              Notes
            </h2>
          </div>
          <p class="m-0 text-sm text-[var(--sea-ink-soft)]">
            {notes().length} saved
          </p>
        </div>

        <form
          class="grid gap-3"
          onSubmit={async (event) => {
            event.preventDefault()
            setError('')
            setIsSaving(true)

            try {
              await createNoteFn({ data: { title: title(), body: body() } })
              setTitle('')
              setBody('')
              await router.invalidate()
            } catch (createError) {
              setError(
                createError instanceof Error
                  ? createError.message
                  : 'Unable to create note',
              )
            } finally {
              setIsSaving(false)
            }
          }}
        >
          <label class="grid gap-1 text-sm font-semibold text-[var(--sea-ink)]">
            Title
            <input
              value={title()}
              onInput={(event) => setTitle(event.currentTarget.value)}
              class="rounded-xl border border-[rgba(23,58,64,0.16)] bg-white/70 px-3 py-2 text-sm font-normal text-[var(--sea-ink)] outline-none transition focus:border-[rgba(50,143,151,0.55)]"
              required
            />
          </label>
          <label class="grid gap-1 text-sm font-semibold text-[var(--sea-ink)]">
            Body
            <textarea
              value={body()}
              onInput={(event) => setBody(event.currentTarget.value)}
              class="min-h-24 rounded-xl border border-[rgba(23,58,64,0.16)] bg-white/70 px-3 py-2 text-sm font-normal text-[var(--sea-ink)] outline-none transition focus:border-[rgba(50,143,151,0.55)]"
            />
          </label>
          <div class="flex flex-wrap items-center gap-3">
            <button
              type="submit"
              disabled={isSaving()}
              class="rounded-full border border-[rgba(50,143,151,0.3)] bg-[rgba(79,184,178,0.14)] px-5 py-2.5 text-sm font-semibold text-[var(--lagoon-deep)] transition hover:-translate-y-0.5 hover:bg-[rgba(79,184,178,0.24)] disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:translate-y-0"
            >
              {isSaving() ? 'Saving...' : 'Create Note'}
            </button>
            <Show when={error()}>
              <p class="m-0 text-sm font-semibold text-red-700">{error()}</p>
            </Show>
          </div>
        </form>

        <div class="mt-6 grid gap-3">
          <Show
            when={notes().length > 0}
            fallback={
              <p class="m-0 text-sm text-[var(--sea-ink-soft)]">
                No notes yet.
              </p>
            }
          >
            <For each={notes()}>
              {(note) => (
                <article class="rounded-2xl border border-[rgba(23,58,64,0.12)] bg-white/55 p-4">
                  <h3 class="m-0 text-base font-semibold text-[var(--sea-ink)]">
                    {note.title}
                  </h3>
                  <Show when={note.body}>
                    <p class="mb-0 mt-2 whitespace-pre-wrap text-sm text-[var(--sea-ink-soft)]">
                      {note.body}
                    </p>
                  </Show>
                  <p class="mb-0 mt-3 text-xs text-[var(--sea-ink-soft)]">
                    {new Date(note.createdAt).toLocaleString()}
                  </p>
                </article>
              )}
            </For>
          </Show>
        </div>
      </section>

      <section class="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {[
          [
            'Type-Safe Routing',
            'Routes and links stay in sync across every page.',
          ],
          [
            'Server Functions',
            'Call server code from your UI without creating API boilerplate.',
          ],
          [
            'Streaming by Default',
            'Ship progressively rendered responses for faster experiences.',
          ],
          [
            'Tailwind Native',
            'Design quickly with utility-first styling and reusable tokens.',
          ],
        ].map(([title, desc], index) => (
          <article
            class="island-shell feature-card rise-in rounded-2xl p-5"
            style={{ 'animation-delay': `${index * 90 + 80}ms` }}
          >
            <h2 class="mb-2 text-base font-semibold text-[var(--sea-ink)]">
              {title}
            </h2>
            <p class="m-0 text-sm text-[var(--sea-ink-soft)]">{desc}</p>
          </article>
        ))}
      </section>

      <section class="island-shell mt-8 rounded-2xl p-6">
        <p class="island-kicker mb-2">Quick Start</p>
        <ul class="m-0 list-disc space-y-2 pl-5 text-sm text-[var(--sea-ink-soft)]">
          <li>
            Edit <code>src/routes/index.tsx</code> to customize the home page.
          </li>
          <li>
            Update <code>src/components/Header.tsx</code> for navigation and
            product links.
          </li>
          <li>
            Add routes in <code>src/routes</code> and tweak visual tokens in{' '}
            <code>src/styles.css</code>.
          </li>
        </ul>
      </section>
    </main>
  )
}
