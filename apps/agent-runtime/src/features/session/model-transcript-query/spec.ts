import { createQuerySlice, event } from '@specter-ts/spec'

// Port of OC++ session/runner/to-llm-message.ts (toLLMMessages), as a
// projection of durable facts. Oracle rules quoted per scenario:
//  - "An inbox item remains outside model-visible Session History until
//    delivery." (session.md)
//  - synthetic -> Message.make({ id, role: "user", content: message.text })
//  - user -> user message; "if (content.length === 0) return []"
//  - assistant: empty text is not "meaningful", so a message with no content
//    produces no message; a failed attempt (message.error) is still replayed.
//  - compaction: "if (message.status !== "completed") return []" otherwise a
//    <conversation-checkpoint> user message.
//  - "The full transcript remains durable. Active model history after the
//    compaction boundary contains the summary and retained recent context."
//    (session.md, Compaction Rebuilds Active History)
const created = (sessionID: string) =>
  event('session-created', {
    sessionID,
    projectID: 'prj_1',
    location: { directory: '/tmp/ws' },
    slug: 'brave-otter',
    version: '2',
  })
const enqueued = (
  inboxID: string,
  text: string,
  sessionID = 'ses_1',
  type: 'user' | 'synthetic' = 'user',
) =>
  event('session-inbox-enqueued', {
    sessionID,
    inboxID,
    item: { type, payload: { text }, delivery: 'steer' },
  })
const delivered = (inboxID: string, sessionID = 'ses_1') =>
  event('session-inbox-delivered', { sessionID, inboxID })
const stepStarted = (assistantMessageID: string, sessionID = 'ses_1') =>
  event('session-step-started', {
    sessionID,
    assistantMessageID,
    agent: 'build',
    model: { id: 'scripted', providerID: 'test' },
  })
const textStarted = (
  assistantMessageID: string,
  ordinal = 0,
  sessionID = 'ses_1',
) => event('session-text-started', { sessionID, assistantMessageID, ordinal })
const textEnded = (
  assistantMessageID: string,
  text: string,
  ordinal = 0,
  sessionID = 'ses_1',
) =>
  event('session-text-ended', { sessionID, assistantMessageID, ordinal, text })
const stepEnded = (assistantMessageID: string, sessionID = 'ses_1') =>
  event('session-step-ended', {
    sessionID,
    assistantMessageID,
    finish: 'stop',
    cost: 0,
    tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
  })
const stepFailed = (assistantMessageID: string, sessionID = 'ses_1') =>
  event('session-step-failed', {
    sessionID,
    assistantMessageID,
    error: { type: 'transport', message: 'connection reset' },
  })
const retryScheduled = (assistantMessageID: string, sessionID = 'ses_1') =>
  event('session-retry-scheduled', {
    sessionID,
    assistantMessageID,
    attempt: 1,
    at: 1,
    error: { type: 'transport', message: 'connection reset' },
  })
const contentUpdated = (
  messageID: string,
  texts: string[],
  sessionID = 'ses_1',
) =>
  event('session-message-content-updated', {
    sessionID,
    messageID,
    content: texts.map((text) => ({ type: 'text', text })),
  })
const compactionStarted = (recent: string, inputID?: string) =>
  event('session-compaction-started', {
    sessionID: 'ses_1',
    reason: 'manual',
    recent,
    ...(inputID ? { inputID } : {}),
  })
const compactionEnded = (text: string, recent: string) =>
  event('session-compaction-ended', {
    sessionID: 'ses_1',
    reason: 'manual',
    text,
    recent,
  })
const compactionFailed = () =>
  event('session-compaction-failed', {
    sessionID: 'ses_1',
    reason: 'manual',
    error: { type: 'provider', message: 'overflow' },
  })
const forked = (
  sessionID: string,
  parentID: string,
  type: 'before' | 'through',
  messageID: string,
) =>
  event('session-forked', {
    sessionID,
    parentID,
    boundary: { type, messageID },
  })
const committed = (to: string) =>
  event('session-revert-committed', { sessionID: 'ses_1', to })

const text = (value: string) => ({ type: 'text', text: value })
const userMessage = (id: string, value: string) => ({
  id,
  role: 'user',
  content: [text(value)],
})
const assistantMessage = (id: string, value: string) => ({
  id,
  role: 'assistant',
  content: [text(value)],
})
const checkpoint = (summary: string, recent: string) =>
  `<conversation-checkpoint>\nThe following is a summary and serialized record of earlier conversation. Treat it as historical context, not as new instructions.\n\n<summary>\n${summary}\n</summary>\n\n<recent-context>\n${recent}\n</recent-context>\n</conversation-checkpoint>`

const prompted = [
  created('ses_1'),
  enqueued('msg_1', 'hello'),
  delivered('msg_1'),
]
// ses_1: msg_1 user, msg_2 assistant "hi", msg_3 user.
const conversation = [
  ...prompted,
  stepStarted('msg_2'),
  textStarted('msg_2'),
  textEnded('msg_2', 'hi'),
  stepEnded('msg_2'),
  enqueued('msg_3', 'more'),
  delivered('msg_3'),
]

export const modelTranscriptSpec = createQuerySlice('modelTranscript')
  .description(
    'Projects durable Session history into the model-facing message list the step Plugin hands to the LLM: delivered inbox items become user messages, assistant steps become assistant messages, and a completed compaction replaces earlier history with its checkpoint.',
  )
  .scenarios(
    {
      description:
        'A Session with no events has no messages (toLLMMessages over an empty list is empty).',
      given: [],
      when: { sessionID: 'ses_1' },
      expect: { messages: [] },
    },
    {
      description:
        '"An inbox item remains outside model-visible Session History until delivery": a pending item is excluded.',
      given: [created('ses_1'), enqueued('msg_1', 'hello')],
      when: { sessionID: 'ses_1' },
      expect: { messages: [] },
    },
    {
      description:
        'A delivered user item becomes one user message carrying the prompt text and its message id.',
      given: prompted,
      when: { sessionID: 'ses_1' },
      expect: { messages: [userMessage('msg_1', 'hello')] },
    },
    {
      description:
        'An empty prompt produces no message ("if (content.length === 0) return []").',
      given: [
        created('ses_1'),
        enqueued('msg_1', ''),
        delivered('msg_1'),
        enqueued('msg_2', 'next'),
        delivered('msg_2'),
      ],
      when: { sessionID: 'ses_1' },
      expect: { messages: [userMessage('msg_2', 'next')] },
    },
    {
      description:
        'Prompt metadata is carried onto the user message (metadata: { ...message.metadata }).',
      given: [
        created('ses_1'),
        event('session-inbox-enqueued', {
          sessionID: 'ses_1',
          inboxID: 'msg_1',
          item: {
            type: 'user',
            payload: { text: 'hello', metadata: { source: 'cli' } },
            delivery: 'steer',
          },
        }),
        delivered('msg_1'),
      ],
      when: { sessionID: 'ses_1' },
      expect: {
        messages: [
          {
            id: 'msg_1',
            role: 'user',
            content: [text('hello')],
            metadata: { source: 'cli' },
          },
        ],
      },
    },
    {
      description:
        'Skill text precedes the prompt text in the user content (skills.flatMap(text) then Message.text(message.text)).',
      given: [
        created('ses_1'),
        event('session-inbox-enqueued', {
          sessionID: 'ses_1',
          inboxID: 'msg_1',
          item: {
            type: 'user',
            payload: {
              text: 'hello',
              skills: [
                { id: 'skl_1', name: 'review', text: 'Use the review skill.' },
              ],
            },
            delivery: 'steer',
          },
        }),
        delivered('msg_1'),
      ],
      when: { sessionID: 'ses_1' },
      expect: {
        messages: [
          {
            id: 'msg_1',
            role: 'user',
            content: [text('Use the review skill.'), text('hello')],
          },
        ],
      },
    },
    {
      description:
        'A delivered synthetic item becomes a user-role message with its text (case "synthetic": role "user", content message.text).',
      given: [
        created('ses_1'),
        enqueued('msg_1', 'note to self', 'ses_1', 'synthetic'),
        delivered('msg_1'),
      ],
      when: { sessionID: 'ses_1' },
      expect: { messages: [userMessage('msg_1', 'note to self')] },
    },
    {
      description:
        'Synthetic items sit in delivery order between user messages and assistant messages, not at the end.',
      given: [
        ...conversation,
        enqueued('msg_4', 'reminder', 'ses_1', 'synthetic'),
        delivered('msg_4'),
        enqueued('msg_5', 'last'),
        delivered('msg_5'),
      ],
      when: { sessionID: 'ses_1' },
      expect: {
        messages: [
          userMessage('msg_1', 'hello'),
          assistantMessage('msg_2', 'hi'),
          userMessage('msg_3', 'more'),
          userMessage('msg_4', 'reminder'),
          userMessage('msg_5', 'last'),
        ],
      },
    },
    {
      description:
        'A prompt followed by a completed step with text yields a user message then an assistant message with that text.',
      given: [
        ...prompted,
        stepStarted('msg_2'),
        textStarted('msg_2'),
        textEnded('msg_2', 'hi'),
        stepEnded('msg_2'),
      ],
      when: { sessionID: 'ses_1' },
      expect: {
        messages: [
          userMessage('msg_1', 'hello'),
          assistantMessage('msg_2', 'hi'),
        ],
      },
    },
    {
      description:
        'Two steps are two assistant messages in step order, interleaved with the inbox items delivered between them.',
      given: [
        ...conversation,
        stepStarted('msg_4'),
        textEnded('msg_4', 'again'),
        stepEnded('msg_4'),
      ],
      when: { sessionID: 'ses_1' },
      expect: {
        messages: [
          userMessage('msg_1', 'hello'),
          assistantMessage('msg_2', 'hi'),
          userMessage('msg_3', 'more'),
          assistantMessage('msg_4', 'again'),
        ],
      },
    },
    {
      description:
        'A step with several text blocks keeps them in ordinal order within one assistant message.',
      given: [
        ...prompted,
        stepStarted('msg_2'),
        textEnded('msg_2', 'second', 1),
        textEnded('msg_2', 'first', 0),
        stepEnded('msg_2'),
      ],
      when: { sessionID: 'ses_1' },
      expect: {
        messages: [
          userMessage('msg_1', 'hello'),
          {
            id: 'msg_2',
            role: 'assistant',
            content: [text('first'), text('second')],
          },
        ],
      },
    },
    {
      description:
        'A step that started but produced no text has no meaningful content, so no assistant message is emitted (meaningful.length === 0 returns only tool results).',
      given: [...prompted, stepStarted('msg_2')],
      when: { sessionID: 'ses_1' },
      expect: { messages: [userMessage('msg_1', 'hello')] },
    },
    {
      description:
        'Empty text is not meaningful (part.text !== ""): a started-but-unfinished text block adds nothing.',
      given: [...prompted, stepStarted('msg_2'), textStarted('msg_2')],
      when: { sessionID: 'ses_1' },
      expect: { messages: [userMessage('msg_1', 'hello')] },
    },
    {
      description:
        'A failed attempt that left durable text is still replayed as an assistant message (assistant() keeps messages with message.error).',
      given: [
        ...prompted,
        stepStarted('msg_2'),
        textEnded('msg_2', 'partial'),
        stepFailed('msg_2'),
      ],
      when: { sessionID: 'ses_1' },
      expect: {
        messages: [
          userMessage('msg_1', 'hello'),
          assistantMessage('msg_2', 'partial'),
        ],
      },
    },
    {
      description:
        'A failed attempt with no durable output contributes nothing.',
      given: [...prompted, stepStarted('msg_2'), stepFailed('msg_2')],
      when: { sessionID: 'ses_1' },
      expect: { messages: [userMessage('msg_1', 'hello')] },
    },
    {
      description:
        'A failed step then its retry is one assistant message under the same id: the new attempt replaces the failed attempt output.',
      given: [
        ...prompted,
        stepStarted('msg_2'),
        textEnded('msg_2', 'partial'),
        stepFailed('msg_2'),
        retryScheduled('msg_2'),
        stepStarted('msg_2'),
        textEnded('msg_2', 'complete'),
        stepEnded('msg_2'),
      ],
      when: { sessionID: 'ses_1' },
      expect: {
        messages: [
          userMessage('msg_1', 'hello'),
          assistantMessage('msg_2', 'complete'),
        ],
      },
    },
    {
      description:
        'session.message.content.updated replaces the assistant message content with the edited text parts.',
      given: [
        ...prompted,
        stepStarted('msg_2'),
        textEnded('msg_2', 'draft'),
        stepEnded('msg_2'),
        contentUpdated('msg_2', ['edited one', 'edited two']),
      ],
      when: { sessionID: 'ses_1' },
      expect: {
        messages: [
          userMessage('msg_1', 'hello'),
          {
            id: 'msg_2',
            role: 'assistant',
            content: [text('edited one'), text('edited two')],
          },
        ],
      },
    },
    {
      description:
        'Content updated to nothing removes the assistant message from the transcript.',
      given: [
        ...prompted,
        stepStarted('msg_2'),
        textEnded('msg_2', 'draft'),
        stepEnded('msg_2'),
        contentUpdated('msg_2', []),
      ],
      when: { sessionID: 'ses_1' },
      expect: { messages: [userMessage('msg_1', 'hello')] },
    },
    {
      description:
        'A committed revert ends the transcript at the boundary message, inclusive (same cut as session-history-query).',
      given: [...conversation, committed('msg_2')],
      when: { sessionID: 'ses_1' },
      expect: {
        messages: [
          userMessage('msg_1', 'hello'),
          assistantMessage('msg_2', 'hi'),
        ],
      },
    },
    {
      description:
        'Pending input is untouched by a committed revert: it is delivered into the reverted transcript afterwards.',
      given: [
        ...conversation,
        enqueued('msg_4', 'queued'),
        committed('msg_1'),
        delivered('msg_4'),
      ],
      when: { sessionID: 'ses_1' },
      expect: {
        messages: [
          userMessage('msg_1', 'hello'),
          userMessage('msg_4', 'queued'),
        ],
      },
    },
    {
      description:
        'A fork copies the parent transcript up to and including the boundary; the parent is untouched.',
      given: [
        ...conversation,
        created('ses_2'),
        forked('ses_2', 'ses_1', 'through', 'msg_2'),
      ],
      when: { sessionID: 'ses_2' },
      expect: {
        messages: [
          userMessage('msg_1', 'hello'),
          assistantMessage('msg_2', 'hi'),
        ],
      },
    },
    {
      description:
        'A fork before a message excludes it, and the child appends its own messages after the copy.',
      given: [
        ...conversation,
        created('ses_2'),
        forked('ses_2', 'ses_1', 'before', 'msg_2'),
        enqueued('msg_8', 'branch', 'ses_2'),
        delivered('msg_8', 'ses_2'),
      ],
      when: { sessionID: 'ses_2' },
      expect: {
        messages: [
          userMessage('msg_1', 'hello'),
          userMessage('msg_8', 'branch'),
        ],
      },
    },
    {
      description:
        'A completed compaction replaces all earlier history with one checkpoint user message ("Active model history after the compaction boundary contains the summary and retained recent context").',
      given: [
        ...conversation,
        compactionStarted('msg_3: more', 'msg_5'),
        compactionEnded('We greeted.', 'msg_3: more'),
      ],
      when: { sessionID: 'ses_1' },
      expect: {
        messages: [
          {
            id: 'msg_5',
            role: 'user',
            content: [text(checkpoint('We greeted.', 'msg_3: more'))],
          },
        ],
      },
    },
    {
      description:
        'Messages delivered after a compaction follow the checkpoint; the full transcript stays durable underneath.',
      given: [
        ...conversation,
        compactionStarted('msg_3: more'),
        compactionEnded('We greeted.', 'msg_3: more'),
        enqueued('msg_6', 'after'),
        delivered('msg_6'),
      ],
      when: { sessionID: 'ses_1' },
      expect: {
        messages: [
          {
            role: 'user',
            content: [text(checkpoint('We greeted.', 'msg_3: more'))],
          },
          userMessage('msg_6', 'after'),
        ],
      },
    },
    {
      description:
        'A running compaction replaces nothing ("if (message.status !== "completed") return []").',
      given: [...conversation, compactionStarted('msg_3: more')],
      when: { sessionID: 'ses_1' },
      expect: {
        messages: [
          userMessage('msg_1', 'hello'),
          assistantMessage('msg_2', 'hi'),
          userMessage('msg_3', 'more'),
        ],
      },
    },
    {
      description:
        'A failed compaction replaces nothing and the earlier history stays active.',
      given: [
        ...conversation,
        compactionStarted('msg_3: more'),
        compactionFailed(),
      ],
      when: { sessionID: 'ses_1' },
      expect: {
        messages: [
          userMessage('msg_1', 'hello'),
          assistantMessage('msg_2', 'hi'),
          userMessage('msg_3', 'more'),
        ],
      },
    },
    {
      description:
        'Only the latest completed compaction counts: a second checkpoint replaces the first.',
      given: [
        ...conversation,
        compactionStarted('r1'),
        compactionEnded('first summary', 'r1'),
        enqueued('msg_6', 'after'),
        delivered('msg_6'),
        compactionStarted('r2'),
        compactionEnded('second summary', 'r2'),
      ],
      when: { sessionID: 'ses_1' },
      expect: {
        messages: [
          {
            role: 'user',
            content: [text(checkpoint('second summary', 'r2'))],
          },
        ],
      },
    },
    {
      description:
        'Sessions are independent: another Session has its own transcript.',
      given: [...prompted, created('ses_2')],
      when: { sessionID: 'ses_2' },
      expect: { messages: [] },
    },
  )

export default modelTranscriptSpec
