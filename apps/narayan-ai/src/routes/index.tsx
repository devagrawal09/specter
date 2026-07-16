import { createFileRoute } from '@tanstack/solid-router'
import { useServerFn } from '@tanstack/solid-start'
import { For, Show, createResource, createSignal } from 'solid-js'

import {
  createNarayanTestInboundMessage,
  getNarayanHomeData,
} from '../features/narayan/server-functions'

export const Route = createFileRoute('/')({ component: Home })

function Home() {
  const homeDataFn = useServerFn(getNarayanHomeData)
  const createTestInboundFn = useServerFn(createNarayanTestInboundMessage)
  const [draft, setDraft] = createSignal('Do you have Banarasi silk sarees?')
  const [from, setFrom] = createSignal('whatsapp:+15551234567')
  const [homeData, { refetch }] = createResource(() => homeDataFn(), {
    initialValue: { conversations: [], messages: [] },
  })

  async function submitTestMessage(event: SubmitEvent) {
    event.preventDefault()
    await createTestInboundFn({ data: { from: from(), body: draft() } })
    await refetch()
  }

  return (
    <main class="min-h-screen bg-[#110f0c] px-6 py-8 text-stone-100">
      <section class="mx-auto grid max-w-6xl gap-6 lg:grid-cols-[1.1fr_0.9fr]">
        <div class="rounded-[2rem] border border-amber-300/20 bg-gradient-to-br from-stone-950 to-[#1b130b] p-8 shadow-2xl shadow-black/30">
          <p class="text-sm uppercase tracking-[0.4em] text-amber-300/80">
            Specter starter
          </p>
          <h1 class="mt-4 max-w-3xl text-5xl font-semibold tracking-tight text-amber-50">
            Narayan AI WhatsApp commerce assistant
          </h1>
          <p class="mt-5 max-w-2xl text-lg leading-8 text-stone-300">
            A TanStack Solid Start app backed by Specter events, Drizzle SQLite,
            Twilio WhatsApp webhooks, and Mastra/OpenRouter assistant replies.
          </p>

          <div class="mt-8 grid gap-3 sm:grid-cols-2">
            <StatusCard label="Vite port" value="41735 strict" />
            <StatusCard label="Webhook" value="POST /api/twilio/incoming" />
            <StatusCard label="Database" value="NARAYAN_AI_DB_PATH" />
            <StatusCard label="AI fallback" value="Works without secrets" />
          </div>

          <form
            class="mt-8 rounded-3xl border border-stone-700 bg-stone-950/70 p-5"
            onSubmit={submitTestMessage}
          >
            <h2 class="text-lg font-medium text-amber-100">Local smoke test</h2>
            <p class="mt-1 text-sm text-stone-400">
              Dispatches the same Specter command as the Twilio webhook.
            </p>
            <label class="mt-4 block text-sm text-stone-300">
              From
              <input
                class="mt-2 w-full rounded-2xl border border-stone-700 bg-black/30 px-4 py-3 text-stone-100 outline-none focus:border-amber-300"
                value={from()}
                onInput={(event) => setFrom(event.currentTarget.value)}
              />
            </label>
            <label class="mt-4 block text-sm text-stone-300">
              Message
              <textarea
                class="mt-2 min-h-24 w-full rounded-2xl border border-stone-700 bg-black/30 px-4 py-3 text-stone-100 outline-none focus:border-amber-300"
                value={draft()}
                onInput={(event) => setDraft(event.currentTarget.value)}
              />
            </label>
            <button
              class="mt-4 rounded-full bg-amber-300 px-5 py-3 font-medium text-stone-950 transition hover:bg-amber-200"
              type="submit"
            >
              Send test inbound
            </button>
          </form>
        </div>

        <aside class="rounded-[2rem] border border-stone-700 bg-stone-950/80 p-6">
          <h2 class="text-2xl font-semibold text-amber-50">Setup</h2>
          <ol class="mt-5 space-y-3 text-sm leading-6 text-stone-300">
            <li>
              1. Copy `.env.example` to `.env` and fill Twilio/OpenRouter
              values.
            </li>
            <li>2. Run `pnpm --filter @specter/narayan-ai db:migrate`.</li>
            <li>
              3. Configure Twilio sandbox webhook to your public
              `/api/twilio/incoming` URL.
            </li>
            <li>
              4. Keep `TWILIO_VALIDATE_SIGNATURE=false` only for local curl
              tests.
            </li>
          </ol>
        </aside>
      </section>

      <section class="mx-auto mt-6 grid max-w-6xl gap-6 lg:grid-cols-[0.8fr_1.2fr]">
        <Panel title="Conversations">
          <Show
            when={homeData().conversations.length}
            fallback={<Empty text="No WhatsApp messages recorded yet." />}
          >
            <For each={homeData().conversations}>
              {(conversation) => (
                <article class="rounded-2xl border border-stone-800 bg-black/20 p-4">
                  <div class="flex items-center justify-between gap-3">
                    <h3 class="font-medium text-amber-100">
                      {conversation.phoneNumber}
                    </h3>
                    <span class="rounded-full bg-stone-800 px-3 py-1 text-xs text-stone-300">
                      {conversation.messageCount} messages
                    </span>
                  </div>
                  <p class="mt-2 text-sm text-stone-300">
                    {conversation.lastMessageBody}
                  </p>
                  <p class="mt-2 text-xs uppercase tracking-wide text-stone-500">
                    {conversation.lastMessageDirection} ·{' '}
                    {conversation.lastMessageStatus}
                  </p>
                </article>
              )}
            </For>
          </Show>
        </Panel>

        <Panel title="Recent Messages">
          <Show
            when={homeData().messages.length}
            fallback={
              <Empty text="The latest conversation will appear here." />
            }
          >
            <For each={homeData().messages}>
              {(message) => (
                <article class="rounded-2xl border border-stone-800 bg-black/20 p-4">
                  <div class="flex items-center justify-between gap-3">
                    <span class="font-medium text-amber-100">
                      {message.direction}
                    </span>
                    <span class="text-xs text-stone-500">{message.status}</span>
                  </div>
                  <p class="mt-2 text-stone-200">{message.body}</p>
                  <p class="mt-2 text-xs text-stone-500">{message.createdAt}</p>
                </article>
              )}
            </For>
          </Show>
        </Panel>
      </section>
    </main>
  )
}

function StatusCard(props: { label: string; value: string }) {
  return (
    <div class="rounded-3xl border border-stone-700 bg-black/20 p-4">
      <p class="text-xs uppercase tracking-[0.2em] text-stone-500">
        {props.label}
      </p>
      <p class="mt-2 text-amber-100">{props.value}</p>
    </div>
  )
}

function Panel(props: {
  title: string
  children: import('solid-js').JSX.Element
}) {
  return (
    <section class="rounded-[2rem] border border-stone-700 bg-stone-950/80 p-6">
      <h2 class="text-2xl font-semibold text-amber-50">{props.title}</h2>
      <div class="mt-5 space-y-3">{props.children}</div>
    </section>
  )
}

function Empty(props: { text: string }) {
  return (
    <div class="rounded-2xl border border-dashed border-stone-700 p-6 text-stone-400">
      {props.text}
    </div>
  )
}
