import { testSliceImplementations } from '@specter-ts/core/testing'

import { sqliteScenario } from '../../db/scenario-tests'
import { eventsForSliceImplementations } from '../../testing/scenario-events'
import { specterCodeEventDefinitions } from './registry'
import createPost from './create-post/impl'
import createWorkspace from './create-workspace/impl'
import recordVisibleAgentReply from './record-visible-agent-reply/impl'
import replyToPost from './reply-to-post/impl'
import workspaceChat from './workspace-chat/impl'
import workspaceList from './workspace-list/impl'

const registrations = [
  createWorkspace,
  workspaceList,
  createPost,
  replyToPost,
  recordVisibleAgentReply,
  workspaceChat,
] as const
const events = eventsForSliceImplementations(
  registrations,
  specterCodeEventDefinitions,
)

testSliceImplementations(registrations, {
  events,
  runScenario: sqliteScenario,
})
