import { createReactiveComputation } from './create-reactive-computation/impl'
import { createReactiveEffect } from './create-reactive-effect/impl'
import { createReactiveSignal } from './create-reactive-signal/impl'
import { disposeReactiveGraph } from './dispose-reactive-graph/impl'
import { reactiveNodeValue } from './reactive-node-value/impl'
import { settleReactiveBatch } from './settle-reactive-batch/impl'
import { writeReactiveSignal } from './write-reactive-signal/impl'

export const reactiveRegistrations = {
  createReactiveSignal,
  createReactiveComputation,
  createReactiveEffect,
  writeReactiveSignal,
  settleReactiveBatch,
  reactiveNodeValue,
  disposeReactiveGraph,
} as const
