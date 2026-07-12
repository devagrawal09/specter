import { For, type JSX } from 'solid-js'
import { edges, kindColor, kindLabel, type NodeId, nodes } from './architecture'

export function ArchitectureMap(props: {
  active: NodeId
  onSelect: (id: NodeId) => void
}): JSX.Element {
  const isConnected = (edgeFrom: string, edgeTo: string) =>
    edgeFrom === props.active || edgeTo === props.active

  const selectWithKeyboard = (event: KeyboardEvent, id: NodeId) => {
    if (event.key !== 'Enter' && event.key !== ' ') return

    event.preventDefault()
    props.onSelect(id)
  }

  return (
    <svg class="arch-map" viewBox="0 0 1320 720">
      <title>Conceptual architecture and dataflow of a Specter App</title>
      <desc>
        Slice specifications are completed by command, query, and reaction
        implementations. A validated Specter App coordinates typed client calls,
        Event Definitions, one Event Log, and explicit Reaction Plugins. Select
        a node to inspect its current contract.
      </desc>
      <defs>
        <pattern id="grid" width="40" height="40" patternUnits="userSpaceOnUse">
          <path
            d="M40 0H0V40"
            fill="none"
            stroke="rgba(148,163,184,0.06)"
            stroke-width="1"
          />
        </pattern>
      </defs>

      <rect x="0" y="0" width="1320" height="720" fill="url(#grid)" />

      <g class="arch-edges">
        <For each={edges}>
          {(edge) => {
            const active = () => isConnected(edge.from, edge.to)
            return (
              <g
                class="arch-edge"
                classList={{ 'is-active': active(), 'is-dim': !active() }}
                style={{ '--c': kindColor[edge.color] }}
              >
                <path class="edge-base" d={edge.d} />
                <path class="edge-flow" d={edge.d} />
                <text class="edge-label" x={edge.labelX} y={edge.labelY}>
                  {edge.label}
                </text>
              </g>
            )
          }}
        </For>
      </g>

      <g class="arch-nodes">
        <For each={nodes}>
          {(node) => {
            const active = () => node.id === props.active
            return (
              // biome-ignore lint/a11y/useSemanticElements: SVG groups cannot contain HTML buttons, so each node implements equivalent button semantics.
              <g
                class="arch-node"
                classList={{ 'is-active': active() }}
                style={{ '--c': kindColor[node.kind] }}
                role="button"
                tabIndex={0}
                aria-label={`${node.title}: ${node.subtitle}`}
                aria-pressed={active() ? 'true' : 'false'}
                onClick={() => props.onSelect(node.id)}
                onMouseEnter={() => props.onSelect(node.id)}
                onFocus={() => props.onSelect(node.id)}
                onKeyDown={(event) => selectWithKeyboard(event, node.id)}
              >
                <rect
                  class="node-rect"
                  x={node.x}
                  y={node.y}
                  width={node.w}
                  height={node.h}
                  rx="14"
                />
                <circle
                  class="node-dot"
                  cx={node.x + 20}
                  cy={node.y + 26}
                  r="5"
                />
                <text class="node-kind" x={node.x + 34} y={node.y + 30}>
                  {kindLabel[node.kind]}
                </text>
                <text class="node-title" x={node.x + 20} y={node.y + 60}>
                  {node.title}
                </text>
                <text class="node-sub" x={node.x + 20} y={node.y + 82}>
                  {node.subtitle}
                </text>
              </g>
            )
          }}
        </For>
      </g>
    </svg>
  )
}
