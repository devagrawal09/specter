import { useServerFn } from '@tanstack/solid-start'
import { For, Show, createMemo, createResource } from 'solid-js'

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
  const defaultModelLabel = createMemo(() => {
    const model = settings()?.defaultModel
    return model ? `${model.providerId}/${model.modelId}` : 'No default model'
  })
  const defaultProvider = createMemo(() =>
    settings()?.providers.find(
      (provider: SettingsProvider) => provider.id === settings()?.defaultModel.providerId,
    ),
  )
  const defaultAgent = createMemo(() => settings()?.defaultAgent)
  const coreTools = createMemo(() => {
    const tools = defaultAgent()?.tools ?? []
    const visible = ['read', 'grep', 'shell'].filter((tool) => tools.includes(tool))
    return visible.length ? visible.join(', ') : 'No core tools enabled'
  })

  return (
    <section
      role="region"
      aria-label="Model and agent settings"
      class="flex min-h-0 flex-col overflow-hidden rounded-[1.35rem] border border-violet-100/10 bg-slate-950/45 p-3 shadow-inner shadow-black/20"
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
            <article class="rounded-xl border border-violet-300/20 bg-violet-300/10 p-2.5">
              <div class="font-mono text-[0.65rem] uppercase tracking-[0.18em] text-violet-100/80">Default model</div>
              <div class="mt-1 truncate text-xs font-semibold text-white">{defaultModelLabel()}</div>
              <div class="mt-1 flex flex-wrap items-center gap-1.5 text-[0.68rem] text-slate-300">
                <span>{defaultProvider()?.name ?? 'Unknown provider'}</span>
                <span class="rounded-full border border-white/10 bg-black/20 px-1.5 py-0.5">
                  {defaultProvider()?.configured ? 'configured' : 'missing key'}
                </span>
              </div>
            </article>

            <article class="rounded-xl border border-cyan-300/20 bg-cyan-300/10 p-2.5">
              <div class="font-mono text-[0.65rem] uppercase tracking-[0.18em] text-cyan-100/80">Default agent</div>
              <div class="mt-1 truncate text-xs font-semibold text-white">{defaultAgent()?.name ?? 'No default agent'}</div>
              <div class="mt-1 text-[0.68rem] text-slate-300">{coreTools()}</div>
            </article>

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
