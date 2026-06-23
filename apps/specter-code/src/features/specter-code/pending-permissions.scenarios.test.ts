import { testScenarios } from '@specter-ts/core/testing'

import { sqliteScenario } from '../../db/scenario-tests'
import pendingPermissions from './pending-permissions/slice'
import replyToolApproval from './reply-tool-approval/slice'
import requestToolApproval from './request-tool-approval/slice'

const permissionRegistrations = [
  requestToolApproval,
  replyToolApproval,
  pendingPermissions,
] as const

testScenarios(permissionRegistrations, {
  runScenario: sqliteScenario,
})
