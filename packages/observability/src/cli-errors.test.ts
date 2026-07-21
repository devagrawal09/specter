import { describe, expect, it } from 'vitest'

import { publicCliErrorMessage, UsageError } from './cli-errors'

describe('CLI error reporting', () => {
  it('preserves local usage guidance and sanitizes operational failures', () => {
    expect(
      publicCliErrorMessage(new UsageError('trace requires an operation ID')),
    ).toBe('trace requires an operation ID')
    expect(
      publicCliErrorMessage(
        new Error('postgres://admin:secret@database.internal/collector'),
      ),
    ).toBe('The Specter runtime could not complete the request.')
  })
})
