import { testSliceImplementations } from '@specter-ts/core/testing'

import { sqliteScenario } from '../../../db/scenario-tests'
import publishAgentRunReply from './impl'
import {
  agentRunCompletedEvent,
  agentRunFailedEvent,
  agentRunRequestedEvent,
  agentRunStreamedEvent,
  postReplyCreatedEvent,
} from '../events'

testSliceImplementations([publishAgentRunReply], {
  events: [
    agentRunRequestedEvent,
    agentRunStreamedEvent,
    agentRunCompletedEvent,
    agentRunFailedEvent,
    postReplyCreatedEvent,
  ],
  runScenario: sqliteScenario,
})
