import { protocolErrorCodes, SpecterProtocolError } from './errors'
import type { CapabilitiesRequest, ProtocolCapability } from './types'

export function negotiateCapabilities(
  request: Pick<CapabilitiesRequest, 'required' | 'optional'>,
  supported: readonly ProtocolCapability[],
): readonly ProtocolCapability[] {
  const supportedSet = new Set(supported)
  const missing = (request.required ?? []).filter(
    (name) => !supportedSet.has(name),
  )
  if (missing.length > 0) {
    throw new SpecterProtocolError({
      code: protocolErrorCodes.unsupportedCapability,
      message: `Required capabilities are unsupported: ${missing.join(', ')}.`,
      status: 400,
      details: { missing },
    })
  }
  return [
    ...new Set([...(request.required ?? []), ...(request.optional ?? [])]),
  ].filter((name) => supportedSet.has(name))
}
