import { testScenarios } from '@specter-ts/core/testing'

import { todoSqlRegistrations } from './registry'

testScenarios(todoSqlRegistrations, {
  sqliteFilenameEnv: 'SPECTER_SQLITE_PATH',
})
