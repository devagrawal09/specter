// Session-shaped Specter app used only by app-construction.ts. Specs are built
// in code with @specter-ts/spec and passed straight to implement*, which
// accepts the same portable object a spec.json export would contain.
import {
  createEventDefinition,
  implementCommand,
  implementQuery,
  implementReaction,
  type SliceStoreService,
} from '@specter-ts/core'
import {
  createCommandSlice,
  createQuerySlice,
  createReactionSlice,
  event,
} from '@specter-ts/spec'
import { Context } from 'effect'
import { z } from 'zod'

export type SessionState = {
  created: boolean
  archived: boolean
  title?: string
  titled: boolean
  failedTurns: number
  firstMessage?: string
  messages: { id: string; role: 'user' | 'assistant'; text: string }[]
  toolCalls: Record<string, { tool: string; status: string }>
}

export const createSessionState = (): SessionState => ({
  created: false,
  archived: false,
  titled: false,
  failedTurns: 0,
  messages: [],
  toolCalls: {},
})

export const SessionStore = Context.Service<
  SliceStoreService<SessionState, SessionState, unknown>
>('@specter/bench/SessionStore')

const sessionCreated = createEventDefinition(
  'session-created',
  z.object({ sessionId: z.string(), directory: z.string() }),
)
const sessionRenamed = createEventDefinition(
  'session-renamed',
  z.object({ title: z.string() }),
)
const sessionArchived = createEventDefinition('session-archived', z.object({}))
const userMessageSubmitted = createEventDefinition(
  'user-message-submitted',
  z.object({ messageId: z.string(), text: z.string() }),
)
const assistantMessageStarted = createEventDefinition(
  'assistant-message-started',
  z.object({ messageId: z.string(), model: z.string() }),
)
const assistantTextAppended = createEventDefinition(
  'assistant-text-appended',
  z.object({ messageId: z.string(), text: z.string() }),
)
const reasoningRecorded = createEventDefinition(
  'reasoning-recorded',
  z.object({ messageId: z.string(), text: z.string() }),
)
const assistantMessageCompleted = createEventDefinition(
  'assistant-message-completed',
  z.object({ messageId: z.string(), finishReason: z.string() }),
)
const turnFailed = createEventDefinition(
  'turn-failed',
  z.object({ messageId: z.string(), error: z.string() }),
)
const toolCallRequested = createEventDefinition(
  'tool-call-requested',
  z.object({ toolCallId: z.string(), tool: z.string(), input: z.string() }),
)
const toolCallApproved = createEventDefinition(
  'tool-call-approved',
  z.object({ toolCallId: z.string() }),
)
const toolCallDenied = createEventDefinition(
  'tool-call-denied',
  z.object({ toolCallId: z.string(), reason: z.string() }),
)
const toolCallCompleted = createEventDefinition(
  'tool-call-completed',
  z.object({ toolCallId: z.string(), output: z.string() }),
)
const toolCallFailed = createEventDefinition(
  'tool-call-failed',
  z.object({ toolCallId: z.string(), error: z.string() }),
)
const compactionRecorded = createEventDefinition(
  'compaction-recorded',
  z.object({ summary: z.string(), throughOrder: z.number().int() }),
)

const created = event('session-created', {
  sessionId: 'session-1',
  directory: '/work',
})
const requested = event('tool-call-requested', {
  toolCallId: 'call-1',
  tool: 'read',
  input: '{"path":"a.ts"}',
})

// Commands

const createSession = implementCommand(
  createCommandSlice('createSession')
    .description('Creates a session for a working directory.')
    .scenarios({
      description: 'Creates the session.',
      given: [],
      when: { sessionId: 'session-1', directory: '/work' },
      expect: [created],
    }),
)
  .inputSchema(z.object({ sessionId: z.string(), directory: z.string() }))
  .store(SessionStore)
  .handle(async (command) => [sessionCreated.create(command)])

const renameSession = implementCommand(
  createCommandSlice('renameSession')
    .description('Renames a session.')
    .scenarios({
      description: 'Renames the session.',
      given: [],
      when: { title: 'Fix the build' },
      expect: [event('session-renamed', { title: 'Fix the build' })],
    }),
)
  .inputSchema(z.object({ title: z.string() }))
  .store(SessionStore)
  .handle(async (command) => [sessionRenamed.create(command)])

const archiveSession = implementCommand(
  createCommandSlice('archiveSession')
    .description('Archives a session once.')
    .scenarios(
      {
        description: 'Archives the session.',
        given: [],
        when: {},
        expect: [event('session-archived', {})],
      },
      {
        description: 'Rejects a second archive.',
        given: [event('session-archived', {})],
        when: {},
        expect: [],
        reject: { reason: 'Session is already archived' },
      },
    ),
)
  .inputSchema(z.object({}))
  .store(SessionStore)
  .apply(sessionArchived, async (_event, state) => {
    state.archived = true
  })
  .handle(async (_command, state) => {
    if (state.archived) throw new Error('Session is already archived')
    return [sessionArchived.create({})]
  })

const submitUserMessage = implementCommand(
  createCommandSlice('submitUserMessage')
    .description('Records a user prompt in an existing session.')
    .scenarios(
      {
        description: 'Records the prompt.',
        given: [created],
        when: { messageId: 'message-1', text: 'Fix the build' },
        expect: [
          event('user-message-submitted', {
            messageId: 'message-1',
            text: 'Fix the build',
          }),
        ],
      },
      {
        description: 'Rejects a prompt before the session exists.',
        given: [],
        when: { messageId: 'message-1', text: 'Fix the build' },
        expect: [],
        reject: { reason: 'Session does not exist' },
      },
    ),
)
  .inputSchema(z.object({ messageId: z.string(), text: z.string() }))
  .store(SessionStore)
  .apply(sessionCreated, async (_event, state) => {
    state.created = true
  })
  .handle(async (command, state) => {
    if (!state.created) throw new Error('Session does not exist')
    return [userMessageSubmitted.create(command)]
  })

const recordAssistantOutput = implementCommand(
  createCommandSlice('recordAssistantOutput')
    .description('Records one streamed assistant output part.')
    .scenarios(
      {
        description: 'Records a started message.',
        given: [],
        when: { messageId: 'm', kind: 'started', value: 'model-a' },
        expect: [
          event('assistant-message-started', {
            messageId: 'm',
            model: 'model-a',
          }),
        ],
      },
      {
        description: 'Records text.',
        given: [],
        when: { messageId: 'm', kind: 'text', value: 'Done.' },
        expect: [
          event('assistant-text-appended', { messageId: 'm', text: 'Done.' }),
        ],
      },
      {
        description: 'Records reasoning.',
        given: [],
        when: { messageId: 'm', kind: 'reasoning', value: 'Thinking' },
        expect: [
          event('reasoning-recorded', { messageId: 'm', text: 'Thinking' }),
        ],
      },
      {
        description: 'Records completion.',
        given: [],
        when: { messageId: 'm', kind: 'completed', value: 'stop' },
        expect: [
          event('assistant-message-completed', {
            messageId: 'm',
            finishReason: 'stop',
          }),
        ],
      },
      {
        description: 'Records a failed turn.',
        given: [],
        when: { messageId: 'm', kind: 'failed', value: 'timeout' },
        expect: [event('turn-failed', { messageId: 'm', error: 'timeout' })],
      },
    ),
)
  .inputSchema(
    z.object({
      messageId: z.string(),
      kind: z.enum(['started', 'text', 'reasoning', 'completed', 'failed']),
      value: z.string(),
    }),
  )
  .store(SessionStore)
  .handle(async ({ messageId, kind, value }) => {
    switch (kind) {
      case 'started':
        return [assistantMessageStarted.create({ messageId, model: value })]
      case 'text':
        return [assistantTextAppended.create({ messageId, text: value })]
      case 'reasoning':
        return [reasoningRecorded.create({ messageId, text: value })]
      case 'completed':
        return [
          assistantMessageCompleted.create({ messageId, finishReason: value }),
        ]
      case 'failed':
        return [turnFailed.create({ messageId, error: value })]
    }
  })

const requestToolCall = implementCommand(
  createCommandSlice('requestToolCall')
    .description('Records a model tool call request.')
    .scenarios({
      description: 'Records the request.',
      given: [],
      when: { toolCallId: 'call-1', tool: 'read', input: '{"path":"a.ts"}' },
      expect: [requested],
    }),
)
  .inputSchema(
    z.object({ toolCallId: z.string(), tool: z.string(), input: z.string() }),
  )
  .store(SessionStore)
  .handle(async (command) => [toolCallRequested.create(command)])

const resolveToolCall = implementCommand(
  createCommandSlice('resolveToolCall')
    .description('Approves or denies a pending tool call.')
    .scenarios(
      {
        description: 'Approves a pending call.',
        given: [requested],
        when: { toolCallId: 'call-1', approved: true },
        expect: [event('tool-call-approved', { toolCallId: 'call-1' })],
      },
      {
        description: 'Denies a pending call.',
        given: [requested],
        when: { toolCallId: 'call-1', approved: false },
        expect: [
          event('tool-call-denied', { toolCallId: 'call-1', reason: 'user' }),
        ],
      },
      {
        description: 'Rejects an approved call.',
        given: [
          requested,
          event('tool-call-approved', { toolCallId: 'call-1' }),
        ],
        when: { toolCallId: 'call-1', approved: true },
        expect: [],
        reject: { reason: 'Tool call is not pending' },
      },
      {
        description: 'Rejects a denied call.',
        given: [
          requested,
          event('tool-call-denied', { toolCallId: 'call-1', reason: 'user' }),
        ],
        when: { toolCallId: 'call-1', approved: true },
        expect: [],
        reject: { reason: 'Tool call is not pending' },
      },
    ),
)
  .inputSchema(z.object({ toolCallId: z.string(), approved: z.boolean() }))
  .store(SessionStore)
  .apply(toolCallRequested, async ({ payload }, state) => {
    state.toolCalls[payload.toolCallId] = {
      tool: payload.tool,
      status: 'pending',
    }
  })
  .apply(toolCallApproved, async ({ payload }, state) => {
    const call = state.toolCalls[payload.toolCallId]
    if (call) call.status = 'approved'
  })
  .apply(toolCallDenied, async ({ payload }, state) => {
    const call = state.toolCalls[payload.toolCallId]
    if (call) call.status = 'denied'
  })
  .handle(async ({ toolCallId, approved }, state) => {
    if (state.toolCalls[toolCallId]?.status !== 'pending') {
      throw new Error('Tool call is not pending')
    }
    return approved
      ? [toolCallApproved.create({ toolCallId })]
      : [toolCallDenied.create({ toolCallId, reason: 'user' })]
  })

const recordToolResult = implementCommand(
  createCommandSlice('recordToolResult')
    .description('Records a tool call result.')
    .scenarios(
      {
        description: 'Records output.',
        given: [],
        when: { toolCallId: 'call-1', ok: true, value: 'contents' },
        expect: [
          event('tool-call-completed', {
            toolCallId: 'call-1',
            output: 'contents',
          }),
        ],
      },
      {
        description: 'Records failure.',
        given: [],
        when: { toolCallId: 'call-1', ok: false, value: 'ENOENT' },
        expect: [
          event('tool-call-failed', { toolCallId: 'call-1', error: 'ENOENT' }),
        ],
      },
    ),
)
  .inputSchema(
    z.object({ toolCallId: z.string(), ok: z.boolean(), value: z.string() }),
  )
  .store(SessionStore)
  .handle(async ({ toolCallId, ok, value }) =>
    ok
      ? [toolCallCompleted.create({ toolCallId, output: value })]
      : [toolCallFailed.create({ toolCallId, error: value })],
  )

// Queries

const sessionTranscript = implementQuery(
  createQuerySlice('sessionTranscript')
    .description('Lists visible messages after the last compaction.')
    .scenarios(
      {
        description: 'Returns an empty transcript.',
        given: [],
        when: {},
        expect: [],
      },
      {
        description: 'Returns user and assistant text.',
        given: [
          event('user-message-submitted', { messageId: 'u', text: 'Hi' }),
          event('assistant-message-started', { messageId: 'a', model: 'm' }),
          event('assistant-text-appended', { messageId: 'a', text: 'Hello' }),
          event('assistant-message-completed', {
            messageId: 'a',
            finishReason: 'stop',
          }),
        ],
        when: {},
        expect: [
          { id: 'u', role: 'user', text: 'Hi' },
          { id: 'a', role: 'assistant', text: 'Hello' },
        ],
      },
      {
        description: 'Drops messages before a compaction.',
        given: [
          event('user-message-submitted', { messageId: 'u', text: 'Hi' }),
          event('compaction-recorded', { summary: 'Greeted', throughOrder: 1 }),
        ],
        when: {},
        expect: [],
      },
    ),
)
  .inputSchema(z.object({}))
  .outputSchema<SessionState['messages']>()
  .store(SessionStore)
  .apply(userMessageSubmitted, async ({ payload }, state) => {
    state.messages.push({
      id: payload.messageId,
      role: 'user',
      text: payload.text,
    })
  })
  .apply(assistantMessageStarted, async ({ payload }, state) => {
    state.messages.push({ id: payload.messageId, role: 'assistant', text: '' })
  })
  .apply(assistantTextAppended, async ({ payload }, state) => {
    const message = state.messages.find(({ id }) => id === payload.messageId)
    if (message) message.text += payload.text
  })
  .apply(assistantMessageCompleted, async () => {})
  .apply(compactionRecorded, async (_event, state) => {
    state.messages = []
  })
  .handle(async (_query, state) => state.messages)

const sessionSummary = implementQuery(
  createQuerySlice('sessionSummary')
    .description('Summarizes session lifecycle.')
    .scenarios(
      {
        description: 'Summarizes a missing session.',
        given: [],
        when: {},
        expect: { created: false, archived: false, failedTurns: 0 },
      },
      {
        description: 'Summarizes a session.',
        given: [
          created,
          event('session-renamed', { title: 'Fix' }),
          event('turn-failed', { messageId: 'm', error: 'timeout' }),
          event('session-archived', {}),
        ],
        when: {},
        expect: { created: true, archived: true, title: 'Fix', failedTurns: 1 },
      },
    ),
)
  .inputSchema(z.object({}))
  .outputSchema<{
    created: boolean
    archived: boolean
    title?: string
    failedTurns: number
  }>()
  .store(SessionStore)
  .apply(sessionCreated, async (_event, state) => {
    state.created = true
  })
  .apply(sessionRenamed, async ({ payload }, state) => {
    state.title = payload.title
  })
  .apply(turnFailed, async (_event, state) => {
    state.failedTurns += 1
  })
  .apply(sessionArchived, async (_event, state) => {
    state.archived = true
  })
  .handle(async (_query, state) => ({
    created: state.created,
    archived: state.archived,
    title: state.title,
    failedTurns: state.failedTurns,
  }))

const pendingToolCalls = implementQuery(
  createQuerySlice('pendingToolCalls')
    .description('Lists tool calls that have no result yet.')
    .scenarios(
      {
        description: 'Lists a pending call.',
        given: [requested],
        when: {},
        expect: [{ toolCallId: 'call-1', tool: 'read', status: 'pending' }],
      },
      {
        description: 'Hides finished calls.',
        given: [
          requested,
          event('tool-call-approved', { toolCallId: 'call-1' }),
          event('tool-call-completed', { toolCallId: 'call-1', output: 'x' }),
          event('tool-call-requested', {
            toolCallId: 'call-2',
            tool: 'bash',
            input: '{}',
          }),
          event('tool-call-denied', { toolCallId: 'call-2', reason: 'user' }),
          event('tool-call-requested', {
            toolCallId: 'call-3',
            tool: 'read',
            input: '{}',
          }),
          event('tool-call-failed', { toolCallId: 'call-3', error: 'ENOENT' }),
        ],
        when: {},
        expect: [],
      },
    ),
)
  .inputSchema(z.object({}))
  .outputSchema<{ toolCallId: string; tool: string; status: string }[]>()
  .store(SessionStore)
  .apply(toolCallRequested, async ({ payload }, state) => {
    state.toolCalls[payload.toolCallId] = {
      tool: payload.tool,
      status: 'pending',
    }
  })
  .apply(toolCallApproved, async ({ payload }, state) => {
    const call = state.toolCalls[payload.toolCallId]
    if (call) call.status = 'approved'
  })
  .apply(toolCallDenied, async ({ payload }, state) => {
    delete state.toolCalls[payload.toolCallId]
  })
  .apply(toolCallCompleted, async ({ payload }, state) => {
    delete state.toolCalls[payload.toolCallId]
  })
  .apply(toolCallFailed, async ({ payload }, state) => {
    delete state.toolCalls[payload.toolCallId]
  })
  .handle(async (_query, state) =>
    Object.entries(state.toolCalls).map(([toolCallId, call]) => ({
      toolCallId,
      ...call,
    })),
  )

// Reactions

const autoApproveReadTools = implementReaction(
  createReactionSlice('autoApproveReadTools')
    .description('Approves read-only tool calls without asking.')
    .scenarios(
      {
        description: 'Approves a pending read.',
        given: [requested],
        expect: [
          {
            type: 'resolveToolCall',
            payload: { toolCallId: 'call-1', approved: true },
          },
        ],
      },
      {
        description: 'Ignores a resolved read.',
        given: [
          requested,
          event('tool-call-approved', { toolCallId: 'call-1' }),
        ],
        expect: [],
      },
      {
        description: 'Ignores a denied read.',
        given: [
          requested,
          event('tool-call-denied', { toolCallId: 'call-1', reason: 'user' }),
        ],
        expect: [],
      },
    ),
)
  .outputSchema()
  .store(SessionStore)
  .apply(toolCallRequested, async ({ payload }, state) => {
    if (payload.tool === 'read') {
      state.toolCalls[payload.toolCallId] = {
        tool: payload.tool,
        status: 'pending',
      }
    }
  })
  .apply(toolCallApproved, async ({ payload }, state) => {
    delete state.toolCalls[payload.toolCallId]
  })
  .apply(toolCallDenied, async ({ payload }, state) => {
    delete state.toolCalls[payload.toolCallId]
  })
  .handle(async (state) => {
    const toolCallId = Object.keys(state.toolCalls)[0]
    return toolCallId
      ? { type: 'resolveToolCall', payload: { toolCallId, approved: true } }
      : undefined
  })

const titleFromFirstMessage = implementReaction(
  createReactionSlice('titleFromFirstMessage')
    .description('Titles an untitled session from its first prompt.')
    .scenarios(
      {
        description: 'Titles from the first prompt.',
        given: [
          event('user-message-submitted', {
            messageId: 'u',
            text: 'Fix the build',
          }),
        ],
        expect: [
          { type: 'renameSession', payload: { title: 'Fix the build' } },
        ],
      },
      {
        description: 'Keeps an existing title.',
        given: [
          event('session-renamed', { title: 'Mine' }),
          event('user-message-submitted', { messageId: 'u', text: 'Fix' }),
        ],
        expect: [],
      },
    ),
)
  .outputSchema()
  .store(SessionStore)
  .apply(userMessageSubmitted, async ({ payload }, state) => {
    state.firstMessage ??= payload.text
  })
  .apply(sessionRenamed, async (_event, state) => {
    state.titled = true
  })
  .handle(async (state) =>
    !state.titled && state.firstMessage
      ? {
          type: 'renameSession',
          payload: { title: state.firstMessage.slice(0, 40) },
        }
      : undefined,
  )

export const sessionAppConfig = {
  events: [
    sessionCreated,
    sessionRenamed,
    sessionArchived,
    userMessageSubmitted,
    assistantMessageStarted,
    assistantTextAppended,
    reasoningRecorded,
    assistantMessageCompleted,
    turnFailed,
    toolCallRequested,
    toolCallApproved,
    toolCallDenied,
    toolCallCompleted,
    toolCallFailed,
    compactionRecorded,
  ],
  slices: {
    createSession,
    renameSession,
    archiveSession,
    submitUserMessage,
    recordAssistantOutput,
    requestToolCall,
    resolveToolCall,
    recordToolResult,
    sessionTranscript,
    sessionSummary,
    pendingToolCalls,
    autoApproveReadTools,
    titleFromFirstMessage,
  },
} as const
