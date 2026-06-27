import { useServerFn } from '@tanstack/solid-start'
import { For, Show, createEffect, createMemo, createResource, createSignal } from 'solid-js'

import { getSpecterCodeSettings } from '../server-functions'
import { Icon } from './shared/view-helpers'

type SettingsProvider = {
  id: string
  name: string
  configured: boolean
  models: Array<{ id: string; name: string }>
}

export function SettingsPanel() {
  const getSettingsFn = useServerFn(getSpecterCodeSettings)
  const [settings] = createResource(() => getSettingsFn())
  const [selectedModel, setSelectedModel] = createSignal('')
  const [selectedAgent, setSelectedAgent] = createSignal('')
  const [isSaving, setIsSaving] = createSignal(false)
  const [saveMessage, setSaveMessage] = createSignal('')
  const [saveError, setSaveError] = createSignal('')
  const defaultModelLabel = createMemo(() => selectedModel() || 'No default model')
  const defaultModelProviderId = createMemo(() => selectedModel().split('/')[0])
  const defaultProvider = createMemo(() =>
    settings()?.providers.find(
      (provider: SettingsProvider) => provider.id === defaultModelProviderId(),
    ),
  )
  const defaultAgent = createMemo(() =>
    settings()?.agents.find((agent) => agent.id === selectedAgent()) ?? settings()?.defaultAgent,
  )
  const modelOptions = createMemo(() =>
    (settings()?.providers ?? []).flatMap((provider: SettingsProvider) =>
      provider.models.map((model) => ({
        value: `${provider.id}/${model.id}`,
        label: `${provider.name} · ${model.name}`,
      })),
    ),
  )
  const coreTools = createMemo(() => {
    const tools = defaultAgent()?.tools ?? []
    const priority = defaultAgent()?.id === 'build'
      ? ['read', 'grep', 'shell']
      : ['glob', 'grep', 'read', 'shell']
    const visible = priority.filter((tool) => tools.includes(tool))
    return visible.length ? visible.join(', ') : 'No core tools enabled'
  })

  createEffect(() => {
    const loaded = settings()
    if (!loaded) return
    setSelectedModel(`${loaded.defaultModel.providerId}/${loaded.defaultModel.modelId}`)
    setSelectedAgent(loaded.defaultAgent.id)
  })

  async function saveSettings(event: SubmitEvent) {
    event.preventDefault()
    if (!selectedModel() || !selectedAgent() || isSaving()) return
    setIsSaving(true)
    setSaveMessage('')
    setSaveError('')
    try {
      const response = await fetch('/config', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          model: selectedModel(),
          default_agent: selectedAgent(),
        }),
      })
      if (!response.ok) {
        throw new Error(`Failed to save settings: ${response.status}`)
      }
      setSaveMessage(`Saved ${selectedAgent()} with ${selectedModel()}`)
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : String(error))
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <section
      role="region"
      aria-label="Model and agent settings"
      class="pointer-events-auto flex min-h-0 flex-col overflow-hidden rounded-[1.35rem] border border-violet-100/10 bg-slate-950/45 p-3 shadow-inner shadow-black/20"
    >
      <div class="flex items-start justify-between gap-2">
        <div class="min-w-0">
          <h3 class="flex items-center gap-2 font-mono text-[0.68rem] font-semibold uppercase tracking-[0.2em] text-slate-300">
            <Icon name="readme" class="text-violet-200" />
            Model and agent settings
          </h3>
          <p class="mt-0.5 truncate text-[0.68rem] text-slate-500">Live OpenCode registries</p>
        </div>
        <span class="shrink-0 rounded-full border border-violet-300/30 bg-violet-300/10 px-2 py-0.5 text-[0.68rem] font-semibold text-violet-100">
          {settings.loading ? 'sync' : `${settings()?.agents.length ?? 0} agents`}
        </span>
      </div>

      <div class="mt-2 min-h-0 flex-1 overflow-y-auto pr-1">
        <Show
          when={settings()}
          fallback={<div class="rounded-xl border border-dashed border-violet-100/15 p-3 text-xs leading-5 text-slate-400">Loading provider, model, and agent registries...</div>}
        >
          <div class="space-y-2">
            <form class="space-y-2" onSubmit={saveSettings}>
              <article class="rounded-xl border border-violet-300/20 bg-violet-300/10 p-2.5">
                <label class="font-mono text-[0.65rem] uppercase tracking-[0.18em] text-violet-100/80" for="specter-code-default-model">Default model</label>
                <div class="mt-1 truncate text-xs font-semibold text-white">{defaultModelLabel()}</div>
                <select
                  id="specter-code-default-model"
                  class="mt-2 w-full rounded-xl border border-violet-200/20 bg-slate-950/80 px-2 py-1.5 text-xs font-semibold text-white outline-none focus:border-violet-200/60"
                  value={selectedModel()}
                  onChange={(event) => setSelectedModel(event.currentTarget.value)}
                >
                  <For each={modelOptions()}>
                    {(model) => <option value={model.value}>{model.label}</option>}
                  </For>
                </select>
                <div class="mt-1 flex flex-wrap items-center gap-1.5 text-[0.68rem] text-slate-300">
                  <span>{defaultProvider()?.name ?? 'Unknown provider'}</span>
                  <span class="rounded-full border border-white/10 bg-black/20 px-1.5 py-0.5">
                    {defaultProvider()?.configured ? 'configured' : 'missing key'}
                  </span>
                </div>
              </article>

              <article class="rounded-xl border border-cyan-300/20 bg-cyan-300/10 p-2.5">
                <label class="font-mono text-[0.65rem] uppercase tracking-[0.18em] text-cyan-100/80" for="specter-code-default-agent">Default agent</label>
                <div class="mt-1 truncate text-xs font-semibold text-white">{defaultAgent()?.name ?? 'No default agent'}</div>
                <select
                  id="specter-code-default-agent"
                  class="mt-2 w-full rounded-xl border border-cyan-200/20 bg-slate-950/80 px-2 py-1.5 text-xs font-semibold text-white outline-none focus:border-cyan-200/60"
                  value={selectedAgent()}
                  onChange={(event) => setSelectedAgent(event.currentTarget.value)}
                >
                  <For each={settings()?.agents ?? []}>
                    {(agent) => <option value={agent.id}>{agent.name}</option>}
                  </For>
                </select>
                <div class="mt-1 text-[0.68rem] text-slate-300">{coreTools()}</div>
              </article>

              <button
                type="submit"
                class="w-full rounded-xl border border-violet-200/20 bg-violet-300/15 px-3 py-1.5 text-xs font-semibold text-violet-50 transition hover:border-violet-100/40 hover:bg-violet-300/25 disabled:cursor-not-allowed disabled:opacity-60"
                disabled={isSaving()}
              >
                {isSaving() ? 'Saving settings...' : 'Save model and agent settings'}
              </button>
              <Show when={saveMessage()}>
                <p class="rounded-lg border border-emerald-300/20 bg-emerald-300/10 px-2 py-1 text-[0.68rem] text-emerald-100">{saveMessage()}</p>
              </Show>
              <Show when={saveError()}>
                <p class="rounded-lg border border-rose-300/20 bg-rose-300/10 px-2 py-1 text-[0.68rem] text-rose-100">{saveError()}</p>
              </Show>
            </form>

            <div class="space-y-1.5">
              <For each={settings()?.providers.slice(0, 3) ?? []}>
                {(provider: SettingsProvider) => (
                  <div class="flex items-center justify-between gap-2 rounded-lg border border-white/10 bg-black/20 px-2 py-1.5 text-[0.68rem]">
                    <span class="truncate text-slate-200">{provider.name}</span>
                    <span class="shrink-0 text-slate-500">{provider.models.length} models</span>
                  </div>
                )}
              </For>
            </div>
          </div>
        </Show>
      </div>
    </section>
  )
}
