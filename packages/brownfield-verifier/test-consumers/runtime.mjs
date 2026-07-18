import {
  AdapterContractTimeoutError,
  createBrownfieldProbe,
  runAdapterContractSuite,
} from '@specter-ts/brownfield-verifier'

if (
  typeof AdapterContractTimeoutError !== 'function' ||
  typeof createBrownfieldProbe !== 'function' ||
  typeof runAdapterContractSuite !== 'function'
) {
  throw new Error('Packed verifier runtime exports are unavailable')
}
