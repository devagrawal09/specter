import { testScenarios } from '@specter-ts/core/testing'

import { sqliteScenario } from '../../db/scenario-tests'
import createPost from './create-post/slice'
import createWorkspace from './create-workspace/slice'
import recordVisibleAgentReply from './record-visible-agent-reply/slice'
import replyToPost from './reply-to-post/slice'
import workspaceChat from './workspace-chat/slice'
import workspaceList from './workspace-list/slice'

testScenarios(
  [
    createWorkspace,
    workspaceList,
    createPost,
    replyToPost,
    recordVisibleAgentReply,
    workspaceChat,
  ],
  {
    runScenario: sqliteScenario,
  },
)
