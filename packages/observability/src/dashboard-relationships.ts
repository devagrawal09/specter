import type { ScenarioEvent } from '@specter-ts/spec'

import type { RuntimeScope } from './dashboard-model'
import type { CollectedSpecification } from './specification-catalog'

export type ContractNode = {
  readonly id: string
  readonly kind: 'event' | 'slice' | 'unresolved-command'
  readonly label: string
  readonly digest?: string
  readonly sliceKind?: CollectedSpecification['document']['kind']
}

export type ContractEdge = {
  readonly id: string
  readonly from: string
  readonly to: string
  readonly kind: 'expects-event' | 'requests-command' | 'uses-given'
  readonly label: 'Expects event' | 'Requests command' | 'Uses in Given'
  readonly scenarios: readonly string[]
}

export type ContractGraph = {
  readonly nodes: readonly ContractNode[]
  readonly edges: readonly ContractEdge[]
}

export function buildContractGraph(
  specifications: readonly CollectedSpecification[],
  scope: RuntimeScope,
): ContractGraph {
  const scoped = specifications.filter((item) =>
    item.sources.some(
      (source) =>
        source.application === scope.application &&
        source.environment === scope.environment,
    ),
  )
  const nodes = new Map<string, ContractNode>()
  const edgeScenarios = new Map<
    string,
    { edge: Omit<ContractEdge, 'scenarios'>; scenarios: Set<string> }
  >()

  for (const item of scoped) {
    const sliceId = sliceNodeId(item.digest)
    nodes.set(sliceId, {
      id: sliceId,
      kind: 'slice',
      label: item.document.name,
      digest: item.digest,
      sliceKind: item.document.kind,
    })
  }

  for (const item of scoped) {
    const sliceId = sliceNodeId(item.digest)
    for (const scenario of item.document.scenarios) {
      for (const event of scenario.given) {
        const eventId = eventNodeId(event.eventType)
        nodes.set(eventId, {
          id: eventId,
          kind: 'event',
          label: event.eventType,
        })
        addEdge(
          edgeScenarios,
          eventId,
          sliceId,
          'uses-given',
          'Uses in Given',
          scenario.description,
        )
      }

      if (item.document.kind === 'command' && Array.isArray(scenario.expect)) {
        for (const value of scenario.expect) {
          if (!isScenarioEvent(value)) continue
          const eventId = eventNodeId(value.eventType)
          nodes.set(eventId, {
            id: eventId,
            kind: 'event',
            label: value.eventType,
          })
          addEdge(
            edgeScenarios,
            sliceId,
            eventId,
            'expects-event',
            'Expects event',
            scenario.description,
          )
        }
      }

      if (item.document.kind === 'reaction' && Array.isArray(scenario.expect)) {
        for (const value of scenario.expect) {
          if (!isCommandEnvelope(value)) continue
          const target = scoped.find(
            (candidate) =>
              candidate.document.kind === 'command' &&
              candidate.document.name === value.type,
          )
          const commandId = target
            ? sliceNodeId(target.digest)
            : unresolvedCommandNodeId(value.type)
          if (!target)
            nodes.set(commandId, {
              id: commandId,
              kind: 'unresolved-command',
              label: value.type,
            })
          addEdge(
            edgeScenarios,
            sliceId,
            commandId,
            'requests-command',
            'Requests command',
            scenario.description,
          )
        }
      }
    }
  }

  return {
    nodes: [...nodes.values()],
    edges: [...edgeScenarios.values()].map(({ edge, scenarios }) => ({
      ...edge,
      scenarios: [...scenarios],
    })),
  }
}

export function focusedContractGraph(
  graph: ContractGraph,
  digest: string,
): ContractGraph {
  const selectedId = sliceNodeId(digest)
  const directNodeIds = new Set<string>([selectedId])
  for (const edge of graph.edges) {
    if (edge.from === selectedId) directNodeIds.add(edge.to)
    if (edge.to === selectedId) directNodeIds.add(edge.from)
  }
  const edges = graph.edges.filter(
    (edge) => directNodeIds.has(edge.from) || directNodeIds.has(edge.to),
  )
  const nodeIds = new Set(
    edges.flatMap((edge) => [edge.from, edge.to]).concat(selectedId),
  )
  return {
    nodes: graph.nodes.filter((node) => nodeIds.has(node.id)),
    edges,
  }
}

export function sliceNodeId(digest: string): string {
  return `slice:${digest}`
}

function eventNodeId(type: string): string {
  return `event:${type}`
}

function unresolvedCommandNodeId(type: string): string {
  return `command:${type}`
}

function addEdge(
  edges: Map<
    string,
    { edge: Omit<ContractEdge, 'scenarios'>; scenarios: Set<string> }
  >,
  from: string,
  to: string,
  kind: ContractEdge['kind'],
  label: ContractEdge['label'],
  scenario: string,
) {
  const id = `${from}\u0000${kind}\u0000${to}`
  const current = edges.get(id)
  if (current) {
    current.scenarios.add(scenario)
    return
  }
  edges.set(id, {
    edge: { id, from, to, kind, label },
    scenarios: new Set([scenario]),
  })
}

function isScenarioEvent(value: unknown): value is ScenarioEvent {
  return (
    typeof value === 'object' &&
    value !== null &&
    'kind' in value &&
    value.kind === 'scenario-event' &&
    'eventType' in value &&
    typeof value.eventType === 'string'
  )
}

function isCommandEnvelope(value: unknown): value is { readonly type: string } {
  return (
    typeof value === 'object' &&
    value !== null &&
    'type' in value &&
    typeof value.type === 'string'
  )
}
