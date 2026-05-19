import { Outlet, createFileRoute, useRouterState } from '@tanstack/solid-router'

export const Route = createFileRoute('/variants')({
  component: VariantsIndex,
})

const variants = [
  {
    name: 'Specs Become Apps',
    href: '/variants/specs-become-apps',
    summary: 'The clearest default: spec, scenario, test, harness, app.',
  },
  {
    name: 'AI Implementation Harness',
    href: '/variants/ai-implementation-harness',
    summary: 'The AI-native pitch: give generated code real contracts.',
  },
  {
    name: 'Vertical Slices',
    href: '/variants/vertical-slices',
    summary: 'The architecture-forward version for slice-minded engineers.',
  },
  {
    name: 'Spec Compiler',
    href: '/variants/spec-compiler',
    summary: 'The strongest compiler-lab metaphor, careful about scope.',
  },
  {
    name: 'Before Code, Shape',
    href: '/variants/before-code-shape',
    summary: 'The premium product-intent version with softer language.',
  },
  {
    name: 'Spec Test Harness',
    href: '/variants/spec-test-harness',
    summary: 'The verification-led pitch: specs become executable tests.',
  },
]

function VariantsIndex() {
  const pathname = useRouterState({
    select: (state) => state.location.pathname,
  })

  if (pathname() !== '/variants') {
    return <Outlet />
  }

  return (
    <main class="page-wrap px-4 py-10 sm:py-14">
      <section class="island-shell rise-in rounded-2xl p-6 sm:p-8 lg:p-10">
        <p class="island-kicker mb-3">Specter landing page lab</p>
        <h1 class="display-title m-0 max-w-4xl text-5xl font-bold leading-[1.02] text-[var(--sea-ink)] sm:text-6xl">
          Six ways to say specs become apps.
        </h1>
        <p class="mt-5 max-w-3xl text-lg leading-8 text-[var(--sea-ink-soft)]">
          Each route explores a different landing-page angle for Specter while
          keeping the same constraints: AI builders, current APIs, compiler-lab
          energy, and the todo app kept out of the headline.
        </p>
      </section>

      <section class="mt-8 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {variants.map((variant) => (
          <a
            href={variant.href}
            class="feature-card block rounded-2xl border border-[var(--line)] p-5 text-[var(--sea-ink)] no-underline transition hover:-translate-y-0.5 hover:text-[var(--sea-ink)]"
          >
            <p class="island-kicker mb-3">Variant</p>
            <h2 class="m-0 text-2xl font-extrabold">{variant.name}</h2>
            <p class="mb-0 mt-3 text-sm leading-7 text-[var(--sea-ink-soft)]">
              {variant.summary}
            </p>
          </a>
        ))}
      </section>
    </main>
  )
}
