import type { JsonValue } from '@specter-ts/spec'

export type ReactiveValue = JsonValue

export type CreateReactiveSignalInput = {
  readonly graphId: string
  readonly batchId: string
  readonly nodeId: string
  readonly initialValue: ReactiveValue
}

export type CreateReactiveCallbackNodeInput = {
  readonly graphId: string
  readonly batchId: string
  readonly nodeId: string
  readonly callbackId: string
}

export type WriteReactiveSignalInput = {
  readonly graphId: string
  readonly batchId: string
  readonly nodeId: string
  readonly value: ReactiveValue
}

export type SettleReactiveBatchInput = {
  readonly graphId: string
  readonly batchId: string
}

export type ReactiveNodeInput = {
  readonly graphId: string
  readonly nodeId: string
}

export type ReactiveNodeValue =
  | {
      readonly status: 'available'
      readonly value: ReactiveValue
    }
  | {
      readonly status: 'batch-open'
      readonly batchId: string
    }
  | {
      readonly status:
        | 'graph-disposed'
        | 'graph-not-found'
        | 'not-found'
        | 'not-readable'
    }

export type DisposeReactiveGraphInput = {
  readonly graphId: string
}

export type ReactiveCallback = () => ReactiveValue | undefined
