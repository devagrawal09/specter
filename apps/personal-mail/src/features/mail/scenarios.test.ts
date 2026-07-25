import { testSliceImplementations } from '@specter-ts/core/testing'
import { expect, test } from 'vitest'

import { sqliteScenario } from '../../db/scenario-tests'
import { mailEventDefinitions } from './events'
import { mailRegistrations } from './registry'

test('every Personal Mail Slice uses the application SQLite Store', () => {
  expect(
    Object.values(mailRegistrations).map(
      (implementation) => implementation.store?.key,
    ),
  ).toEqual(
    Object.values(mailRegistrations).map(
      () => '@specter/personal-mail/SqliteSliceStore',
    ),
  )
})

testSliceImplementations(mailRegistrations, {
  events: mailEventDefinitions,
  runScenario: sqliteScenario(),
})
