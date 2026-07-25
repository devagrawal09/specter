import { describe, expect, it } from 'vitest'

import { HARLAN_APP } from './app-model'

describe('Harlan app identity', () => {
  it('identifies the portable workflow application', () => {
    expect(HARLAN_APP).toEqual({
      id: 'harlan',
      name: 'Harlan',
      model: 'portable-workflow-authoring-and-execution',
      description:
        'Author, save, reuse, and inspect portable task-specific workflows.',
    })
    expect(Object.isFrozen(HARLAN_APP)).toBe(true)
  })
})
