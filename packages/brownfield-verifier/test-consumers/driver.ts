import {
  AdapterContractTimeoutError,
  createBrownfieldProbe,
  runAdapterContractSuite,
  type AdapterContractReport,
  type AdapterHarnessDriver,
  type AdapterHarnessRuntime,
} from '@specter-ts/brownfield-verifier'

declare const runtime: AdapterHarnessRuntime

export const adapterHarnessDriver = {
  name: 'packed-consumer',
  async reset() {},
  async open() {
    return runtime
  },
  async deliveries() {
    return []
  },
  async retryDeadLetter(_deliveryId: string) {},
} satisfies AdapterHarnessDriver

export function verifyAdapters(): Promise<AdapterContractReport> {
  return runAdapterContractSuite(adapterHarnessDriver, {
    caseTimeoutMs: 10_000,
  })
}

export const probeFactory: typeof createBrownfieldProbe = createBrownfieldProbe
export const timeoutError = new AdapterContractTimeoutError('consumer probe', 1)
