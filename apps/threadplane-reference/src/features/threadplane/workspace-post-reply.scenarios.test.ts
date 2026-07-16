import { testSliceImplementations } from '@specter-ts/core/testing'

import { sqliteScenario } from '../../db/scenario-tests'
import createPost from './create-post/impl'
import createWorkspace from './create-workspace/impl'
import recordVisibleAgentReply from './record-visible-agent-reply/impl'
import replyToPost from './reply-to-post/impl'
import workspaceChat from './workspace-chat/impl'
import workspaceList from './workspace-list/impl'
import {
  postCreatedEvent,
  postReplyCreatedEvent,
  workspaceCreatedEvent,
  workspaceFilesystemInitializedEvent,
  workspaceFilesystemScanRequestedEvent,
} from './events'

testSliceImplementations(
  [
    createWorkspace,
    workspaceList,
    createPost,
    replyToPost,
    recordVisibleAgentReply,
    workspaceChat,
  ],
  {
    events: [
      workspaceCreatedEvent,
      workspaceFilesystemInitializedEvent,
      workspaceFilesystemScanRequestedEvent,
      postCreatedEvent,
      postReplyCreatedEvent,
    ],
    runScenario: sqliteScenario,
  },
)
