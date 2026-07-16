import { testSliceImplementations } from '@specter-ts/core/testing'

import { sqliteScenario } from '../../db/scenario-tests'
import { eventsForSliceImplementations } from '../../testing/scenario-events'
import recordFilesystemNodeChanged from './record-filesystem-node-changed/impl'
import recordFilesystemNodeDeleted from './record-filesystem-node-deleted/impl'
import recordFilesystemNodeDiscovered from './record-filesystem-node-discovered/impl'
import recordWorkspaceFilesystemScanCompleted from './record-workspace-filesystem-scan-completed/impl'
import recordWorkspaceFilesystemScanFailed from './record-workspace-filesystem-scan-failed/impl'
import recordWorkspaceFilesystemScanStarted from './record-workspace-filesystem-scan-started/impl'
import requestWorkspaceFilesystemScan from './request-workspace-filesystem-scan/impl'
import runRequestedFilesystemScan from './run-requested-filesystem-scan/impl'
import workspaceFilesystemStatus from './workspace-filesystem-status/impl'
import workspaceFilesystemTree from './workspace-filesystem-tree/impl'
import { specterCodeEventDefinitions } from './registry'

const filesystemRegistrations = [
  requestWorkspaceFilesystemScan,
  recordWorkspaceFilesystemScanStarted,
  recordWorkspaceFilesystemScanCompleted,
  recordWorkspaceFilesystemScanFailed,
  recordFilesystemNodeDiscovered,
  recordFilesystemNodeChanged,
  recordFilesystemNodeDeleted,
  workspaceFilesystemStatus,
  workspaceFilesystemTree,
  runRequestedFilesystemScan,
] as const

testSliceImplementations(filesystemRegistrations, {
  events: eventsForSliceImplementations(
    filesystemRegistrations,
    specterCodeEventDefinitions,
  ),
  runScenario: sqliteScenario,
})
