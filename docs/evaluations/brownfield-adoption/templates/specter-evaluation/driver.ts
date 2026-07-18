import type { AdapterHarnessDriver } from '@specter-ts/brownfield-verifier'

function unfinished(boundary: string): never {
  throw new Error(`Adapter verifier driver is not implemented: ${boundary}`)
}

export const adapterHarnessDriver: AdapterHarnessDriver = {
  name: 'replace-with-assignment-id',
  async reset() {
    unfinished('reset')
  },
  async open() {
    unfinished('open')
  },
  async deliveries() {
    unfinished('deliveries')
  },
  async retryDeadLetter() {
    unfinished('retryDeadLetter')
  },
}
