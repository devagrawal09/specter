import { testSliceImplementations } from '@specter-ts/core/testing'

import { sqliteScenario } from '../../db/scenario-tests'
import { eventsForSliceImplementations } from '../../testing/scenario-events'
import { specterCodeEventDefinitions } from './registry'
import pendingPermissions from './pending-permissions/impl'
import replyToolApproval from './reply-tool-approval/impl'
import requestToolApproval from './request-tool-approval/impl'

const permissionRegistrations = [
  requestToolApproval,
  replyToolApproval,
  pendingPermissions,
] as const
const events = eventsForSliceImplementations(
  permissionRegistrations,
  specterCodeEventDefinitions,
)

testSliceImplementations(permissionRegistrations, {
  events,
  runScenario: sqliteScenario,
})
