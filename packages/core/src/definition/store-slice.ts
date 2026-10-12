import type { SliceStoreSlice } from '../adapters/slice-store'
import type { SliceRegistration } from './slices'

/**
 * A Slice as its Store keeps it: its name, and its State's version, which
 * changes with its specification digest and the `stateVersion` its
 * implementation declares.
 */
export function storeSliceOf(
  slice: Pick<
    SliceRegistration,
    'name' | 'specificationDigest' | 'stateVersion'
  >,
): SliceStoreSlice {
  return {
    name: slice.name,
    version: `${slice.specificationDigest}/${slice.stateVersion}`,
  }
}
