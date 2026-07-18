import { runAdapterContractSuite } from '@specter-ts/brownfield-verifier'

import { adapterHarnessDriver } from './driver.js'

const report = await runAdapterContractSuite(adapterHarnessDriver)

await new Promise<void>((resolve, reject) => {
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`, (error) => {
    if (error) reject(error)
    else resolve()
  })
})
process.exit(report.passed ? 0 : 1)
