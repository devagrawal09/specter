import { For, type JSX } from 'solid-js'
import { edges, kindColor, kindLabel, nodes } from './architecture'

const labelPos: Record<string, { x: number; y: number }> = {
  'client-cmd': { x: 352, y: 146 },
  'client-query': { x: 360, y: 250 },
  'spec-cmd': { x: 350, y: 252 },
  'spec-query': { x: 350, y: 366 },
  'spec-reaction': { x: 350, y: 474 },
  'cmd-event': { x: 726, y: 214 },
  'event-log': { x: 960, y: 338 },
  'log-query': { x: 700, y: 231 },
  'log-reaction': { x: 762, y: 633 },
  'reaction-event': { x: 740, y: 470 },
}

export function ArchitectureMap(props: { active: string }): JSX.Element {
  const isConnected = (edgeFrom: string, edgeTo: string) =>
    edgeFrom === props.active || edgeTo === props.active

  return (
    <svg class="arch-map" viewBox="0 0 1240 680">
      <title>
        Architecture and dataflow map generated from specifications, slices, and
        events
      </title>
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

      <rect x="0" y="0" width="1240" height="680" fill="url(#grid)" />

      <g class="arch-edges">
        <For each={edges}>
          {(edge) => {
            const active = () => isConnected(edge.from, edge.to)
            const pos = labelPos[edge.id]
            return (
              <g
                class="arch-edge"
                classList={{ 'is-active': active(), 'is-dim': !active() }}
                style={{ '--c': kindColor[edge.color] }}
              >
                <path class="edge-base" d={edge.d} />
                <path class="edge-flow" d={edge.d} />
                <text class="edge-label" x={pos.x} y={pos.y}>
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
              <g
                class="arch-node"
                classList={{ 'is-active': active() }}
                style={{ '--c': kindColor[node.kind] }}
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
