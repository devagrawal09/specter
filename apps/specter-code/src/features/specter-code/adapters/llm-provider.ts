export type ProviderModelRef = {
  providerId: string
  modelId: string
}

export type ProviderModelSummary = {
  id: string
  name: string
}

export type ProviderSummary = {
  id: string
  name: string
  type: string
  configured: boolean
  apiKeyEnv?: string
  baseUrl?: string
  models: ProviderModelSummary[]
}

export type SpecterCodeProviderRegistryConfig = {
  model?: ProviderModelRef
  provider?: Record<string, unknown>
}

export type CreateProviderRegistryOptions = {
  config?: SpecterCodeProviderRegistryConfig
  env?: Record<string, string | undefined>
}

type ProviderCatalogEntry = Omit<ProviderSummary, 'configured' | 'models'> & {
  models?: ProviderModelSummary[]
}

const DEFAULT_MODEL: ProviderModelRef = {
  providerId: 'openrouter',
  modelId: 'anthropic/claude-sonnet-4',
}

const DEFAULT_PROVIDER_CATALOG: Record<string, ProviderCatalogEntry> = {
  anthropic: {
    id: 'anthropic',
    name: 'Anthropic',
    type: 'anthropic',
    apiKeyEnv: 'ANTHROPIC_API_KEY',
    models: [
      { id: 'claude-sonnet-4', name: 'Claude Sonnet 4' },
      { id: 'claude-opus-4.1', name: 'Claude Opus 4.1' },
    ],
  },
  openai: {
    id: 'openai',
    name: 'OpenAI',
    type: 'openai',
    apiKeyEnv: 'OPENAI_API_KEY',
    models: [
      { id: 'gpt-5.1', name: 'GPT-5.1' },
      { id: 'gpt-4.1', name: 'GPT-4.1' },
    ],
  },
  openrouter: {
    id: 'openrouter',
    name: 'OpenRouter',
    type: 'openai-compatible',
    apiKeyEnv: 'OPENROUTER_API_KEY',
    baseUrl: 'https://openrouter.ai/api/v1',
    models: [
      { id: 'anthropic/claude-sonnet-4', name: 'Claude Sonnet 4' },
      { id: 'openai/gpt-5.1', name: 'GPT-5.1' },
    ],
  },
}

export class ProviderRegistry {
  readonly #providers: ProviderSummary[]
  readonly #defaultModel: ProviderModelRef

  constructor(providers: ProviderSummary[], defaultModel: ProviderModelRef) {
    this.#providers = providers
    this.#defaultModel = defaultModel
  }

  listProviders() {
    return this.#providers.map((provider) => ({
      ...provider,
      models: [...provider.models],
    }))
  }

  requireProvider(providerId: string) {
    const provider = this.#providers.find((candidate) => candidate.id === providerId)
    if (!provider) throw new Error(`Unknown provider: ${providerId}`)
    return { ...provider, models: [...provider.models] }
  }

  resolveDefaultModel() {
    const provider = this.requireProvider(this.#defaultModel.providerId)
    const model = provider.models.find(
      (candidate) => candidate.id === this.#defaultModel.modelId,
    )

    return {
      providerId: provider.id,
      providerName: provider.name,
      modelId: this.#defaultModel.modelId,
      modelName: model?.name ?? this.#defaultModel.modelId,
      configured: provider.configured,
    }
  }
}

export function createProviderRegistry(options: CreateProviderRegistryOptions = {}) {
  const env = options.env ?? process.env
  const configuredProviders = options.config?.provider ?? {}
  const providerIds = new Set([
    ...Object.keys(DEFAULT_PROVIDER_CATALOG),
    ...Object.keys(configuredProviders),
  ])

  const providers = [...providerIds].map((providerId) => {
    const builtIn = DEFAULT_PROVIDER_CATALOG[providerId]
    const config = readProviderConfig(configuredProviders[providerId])
    const apiKeyEnv = config.apiKeyEnv ?? builtIn?.apiKeyEnv ?? defaultApiKeyEnv(providerId)
    const models = mergeModels(builtIn?.models ?? [], config.models ?? [])

    return {
      id: providerId,
      name: config.name ?? builtIn?.name ?? humanizeProviderId(providerId),
      type: config.type ?? builtIn?.type ?? 'openai-compatible',
      configured: Boolean(apiKeyEnv && env[apiKeyEnv]?.trim()),
      apiKeyEnv,
      baseUrl: config.baseUrl ?? builtIn?.baseUrl,
      models,
    }
  })

  return new ProviderRegistry(providers, options.config?.model ?? DEFAULT_MODEL)
}

function readProviderConfig(value: unknown) {
  if (!isRecord(value)) return {}

  return {
    name: typeof value.name === 'string' ? value.name : undefined,
    type: typeof value.type === 'string' ? value.type : undefined,
    baseUrl:
      typeof value.baseUrl === 'string'
        ? value.baseUrl
        : typeof value.baseURL === 'string'
          ? value.baseURL
          : undefined,
    apiKeyEnv:
      typeof value.apiKeyEnv === 'string'
        ? value.apiKeyEnv
        : typeof value.env === 'string'
          ? value.env
          : undefined,
    models: readModels(value.models),
  }
}

function readModels(value: unknown): ProviderModelSummary[] {
  if (!isRecord(value)) return []

  return Object.entries(value).map(([id, metadata]) => ({
    id,
    name: readModelName(metadata) ?? id,
  }))
}

function readModelName(value: unknown) {
  if (typeof value === 'string') return value
  if (isRecord(value) && typeof value.name === 'string') return value.name
  return undefined
}

function mergeModels(
  builtInModels: readonly ProviderModelSummary[],
  configuredModels: readonly ProviderModelSummary[],
) {
  const models = new Map<string, ProviderModelSummary>()
  for (const model of builtInModels) models.set(model.id, model)
  for (const model of configuredModels) models.set(model.id, model)
  return [...models.values()]
}

function defaultApiKeyEnv(providerId: string) {
  return `${providerId.replaceAll(/[^a-zA-Z0-9]+/g, '_').toUpperCase()}_API_KEY`
}

function humanizeProviderId(providerId: string) {
  return providerId
    .split(/[-_]/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ')
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}
