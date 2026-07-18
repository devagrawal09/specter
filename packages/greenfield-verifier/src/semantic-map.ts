import {
  adopterMappedCapabilities,
  type ProjectSemanticMap,
  type SemanticCapability,
  type SemanticMapping,
} from './types.js'

/**
 * Resolve an adopter mapping without allowing a missing mapped capability to
 * masquerade as a coordinator-owned operational observation.
 */
export function resolveSemanticMapping(
  semanticMap: ProjectSemanticMap,
  semanticId: string,
  capability: SemanticCapability,
): SemanticMapping | undefined {
  const mapping = semanticMap.mappings[semanticId]
  if (
    adopterMappedCapabilities.includes(
      capability as (typeof adopterMappedCapabilities)[number],
    )
  ) {
    if (mapping === undefined) {
      throw new Error(
        `Missing required ${capability} semantic mapping for ${semanticId}`,
      )
    }
    if (mapping.capability !== capability) {
      throw new Error(
        `Semantic capability mismatch for ${semanticId}: mapped ${mapping.capability}, requested ${capability}`,
      )
    }
    return mapping
  }
  if (mapping !== undefined) {
    throw new Error(
      `Operational capability ${capability} must not use adopter mapping ${semanticId}`,
    )
  }
  return undefined
}
