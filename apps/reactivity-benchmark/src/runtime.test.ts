import { describe, expect, it } from 'vitest'

import { createFusedReactivityApp } from './app'

describe('fused runtime history validation', () => {
  it('does not append a malformed Event whose projection rejects it', () => {
    const runtime = createFusedReactivityApp()
    runtime.replay([
      {
        type: 'reactive-signal-created',
        payload: {
          graphId: 'graph-1',
          batchId: 'build-1',
          nodeId: 'signal-1',
          value: 1,
        },
      },
    ])

    expect(() =>
      runtime.replay([
        {
          type: 'reactive-signal-written',
          payload: {
            graphId: 'graph-1',
            batchId: 'build-1',
            nodeId: 'missing',
            previousValue: 1,
            value: 2,
            changed: true,
          },
        },
      ]),
    ).toThrow(/Malformed reactive history/)
    expect(runtime.version).toBe(1)
  })
})
