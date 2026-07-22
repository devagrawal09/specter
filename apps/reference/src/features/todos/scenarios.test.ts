import { testSliceImplementations } from '@specter-ts/core/testing'
import { expect, test } from 'vitest'

import { sqliteScenario } from '../../db/scenario-tests'
import { todoEventDefinitions } from './events'
import { todoRegistrations } from './registry'

test('Todo registry retains every implementation Store tag', () => {
  expect(
    Object.fromEntries(
      Object.entries(todoRegistrations).map(([name, implementation]) => [
        name,
        implementation.store?.key,
      ]),
    ),
  ).toEqual(
    Object.fromEntries(
      Object.keys(todoRegistrations).map((name) => [
        name,
        '@specter/reference/SqliteSliceStore',
      ]),
    ),
  )
})

testSliceImplementations(todoRegistrations, {
  events: todoEventDefinitions,
  runScenario: sqliteScenario({}),
})
