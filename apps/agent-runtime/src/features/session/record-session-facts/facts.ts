// One payload per durable OC++ event, as OC++ publishes it (captured from OC++'s
// own test suite, identifiers normalized). Each is valid for OC++'s schema and
// decodes unchanged, which Specter requires of every stored payload.
export const sessionFacts = {
  'session-created': {
    sessionID: 'ses_1',
    projectID: 'global',
    location: {
      directory: '/a',
    },
    slug: 'routing',
    version: 'test',
  },
  'session-agent-selected': {
    sessionID: 'ses_1',
    agent: 'review',
  },
  'session-model-selected': {
    sessionID: 'ses_1',
    model: {
      id: 'replacement',
      providerID: 'fake',
    },
  },
  'session-tools-selected': {
    sessionID: 'ses_1',
    tools: [],
  },
  'session-moved': {
    sessionID: 'ses_1',
    location: {
      directory: '/b',
    },
    projectID: 'global',
  },
  'session-renamed': {
    sessionID: 'ses_1',
    title: 'Renamed',
  },
  'session-viewed': {
    sessionID: 'ses_1',
    idle: 0,
  },
  'session-deleted': {
    sessionID: 'ses_1',
  },
  'session-forked': {
    sessionID: 'ses_1',
    parentID: 'ses_0',
    boundary: {
      type: 'through',
      messageID: 'msg_fork_codemode',
    },
  },
  'session-inbox-delivered': {
    sessionID: 'ses_1',
    inboxID: 'msg_first',
  },
  'session-inbox-enqueued': {
    sessionID: 'ses_1',
    inboxID: 'msg_first',
    item: {
      type: 'user',
      payload: {
        text: 'first',
      },
      delivery: 'steer',
    },
  },
  'session-inbox-cancelled': {
    sessionID: 'ses_1',
    inboxID: 'msg_cancelled_queue',
  },
  'session-inbox-delivery-changed': {
    sessionID: 'ses_1',
    inboxID: 'msg_120d4f1eb0014acSbWw4y75Onf',
    delivery: 'steer',
  },
  'session-execution-started': {
    sessionID: 'ses_1',
  },
  'session-execution-succeeded': {
    sessionID: 'ses_1',
  },
  'session-execution-failed': {
    sessionID: 'ses_1',
    error: {
      type: 'unknown',
      message: 'failed',
    },
  },
  'session-execution-interrupted': {
    sessionID: 'ses_1',
    reason: 'user',
  },
  'session-instructions-updated': {
    sessionID: 'ses_1',
    delta: {},
  },
  'session-synthetic': {
    sessionID: 'ses_1',
    text: 'Fork boundary',
  },
  'session-displayed': {
    sessionID: 'ses_1',
    blocks: [
      {
        type: 'markdown',
        text: 'Second',
      },
    ],
  },
  'session-skill-activated': {
    sessionID: 'ses_1',
    id: 'effect',
    name: 'Effect',
    text: 'Use Effect',
  },
  'session-shell-started': {
    sessionID: 'ses_1',
    shell: {
      id: 'sh_projector',
      status: 'running',
      command: 'pwd',
      cwd: '/project',
      shell: '/bin/sh',
      file: '/tmp/sh_projector.out',
      metadata: {
        background: true,
      },
      time: {
        started: 0,
      },
    },
  },
  'session-shell-ended': {
    sessionID: 'ses_1',
    shell: {
      id: 'sh_projector',
      status: 'exited',
      command: 'pwd',
      cwd: '/project',
      shell: '/bin/sh',
      file: '/tmp/sh_projector.out',
      exit: 0,
      metadata: {},
      time: {
        started: 0,
        completed: 1,
      },
    },
    output: {
      output: '/project',
      cursor: 8,
      size: 8,
      truncated: false,
    },
  },
  'session-step-started': {
    sessionID: 'ses_1',
    assistantMessageID: 'msg_retry_first',
    agent: 'build',
    model: {
      id: 'model',
      providerID: 'provider',
    },
  },
  'session-step-streamed': {
    sessionID: 'ses_1',
    assistantMessageID: 'msg_ended',
  },
  'session-step-ended': {
    sessionID: 'ses_1',
    assistantMessageID: 'msg_assistant_2',
    finish: 'stop',
    cost: 1.25,
    tokens: {
      input: 10,
      output: 4,
      reasoning: 2,
      cache: {
        read: 3,
        write: 1,
      },
    },
  },
  'session-step-failed': {
    sessionID: 'ses_1',
    assistantMessageID: 'msg_120d46f31001cQVYQHHlOP5V11',
    error: {
      type: 'aborted',
      message: 'Step interrupted',
    },
  },
  'session-text-started': {
    sessionID: 'ses_1',
    assistantMessageID: 'msg_assistant_completed',
    ordinal: 0,
  },
  'session-text-ended': {
    sessionID: 'ses_1',
    assistantMessageID: 'msg_120d494790015kgpzR2ebVz1Vv',
    ordinal: 0,
    text: '',
  },
  'session-reasoning-started': {
    sessionID: 'ses_1',
    assistantMessageID: 'msg_120d4673b001gb4MwJTgG2BW7R',
    ordinal: 0,
  },
  'session-reasoning-ended': {
    sessionID: 'ses_1',
    assistantMessageID: 'msg_120d4673b001gb4MwJTgG2BW7R',
    ordinal: 0,
    text: 'Think',
  },
  'session-tool-input-started': {
    sessionID: 'ses_1',
    assistantMessageID: 'msg_120d46bcb0018vBBYLGAvLOWQT',
    id: 'tool_0',
    name: 'echo',
  },
  'session-tool-input-ended': {
    sessionID: 'ses_1',
    assistantMessageID: 'msg_120d46bcb0018vBBYLGAvLOWQT',
    id: 'tool_0',
    text: '',
  },
  'session-tool-called': {
    sessionID: 'ses_1',
    assistantMessageID: 'msg_120d47b2b001BrE1aLIUaQE9Iu',
    id: 'call-defect',
    input: {},
    executed: false,
  },
  'session-tool-success': {
    sessionID: 'ses_1',
    assistantMessageID: 'msg_hooks',
    id: 'call-hooks',
    content: [
      {
        type: 'text',
        text: 'Execution started',
      },
    ],
    executed: false,
  },
  'session-tool-failed': {
    sessionID: 'ses_1',
    assistantMessageID: 'msg_120d4673b001gb4MwJTgG2BW7R',
    id: 'call-error',
    error: {
      type: 'tool.execution',
      message: 'Denied',
    },
    executed: true,
  },
  'session-codemode-started': {
    sessionID: 'ses_1',
    assistantMessageID: 'msg_hooks',
    id: 'call-hooks',
    executionID: 'exe_120d6eb7a0018Juxs09pbN2YD1',
  },
  'session-codemode-completed': {
    sessionID: 'ses_1',
    assistantMessageID: 'msg_tool_test',
    id: 'call_notebook_later',
    executionID: 'exe_120d4a070001OEFUsw9FIwUf9g',
    events: [],
  },
  'session-codemode-failed': {
    sessionID: 'ses_1',
    assistantMessageID: 'msg_registry',
    id: 'detached-0',
    executionID: 'exe_120d6e54d001jZKD3tFeHCH1qz',
    events: [],
    status: 'cancelled',
    error: 'Execution failed',
  },
  'session-invocation-started': {
    sessionID: 'ses_1',
    executionID: 'exe_120d4bf92001ZrLxicESUosyJQ',
    trigger: {
      type: 'command',
      name: 'look',
      text: '',
    },
    handler: 'look',
    input: {
      text: '',
      command: 'look',
    },
  },
  'session-retry-scheduled': {
    sessionID: 'ses_1',
    assistantMessageID: 'msg_retry_second',
    attempt: 3,
    at: 6000,
    error: {
      type: 'provider.internal',
      message: 'Unavailable',
    },
  },
  'session-compaction-started': {
    sessionID: 'ses_1',
    reason: 'manual',
    recent: '',
  },
  'session-compaction-ended': {
    sessionID: 'ses_1',
    reason: 'manual',
    text: 'summary',
    recent: '',
  },
  'session-compaction-failed': {
    sessionID: 'ses_1',
    reason: 'auto',
    error: {
      type: 'provider.error',
      message: 'summary unavailable',
    },
  },
  'session-revert-staged': {
    sessionID: 'ses_1',
    revert: {
      messageID: 'msg_boundary',
      files: [],
    },
  },
  'session-revert-cleared': {
    sessionID: 'ses_1',
  },
  'session-revert-committed': {
    sessionID: 'ses_1',
    to: 'msg_boundary',
  },
  'session-message-content-updated': {
    sessionID: 'ses_1',
    messageID: 'msg_120d4f6d1001gwPXiERssl4wDM',
    content: [],
  },
  'session-usage-recorded': {
    sessionID: 'ses_1',
    source: 'title',
    cost: 0,
    tokens: {
      input: 0,
      output: 0,
      reasoning: 0,
      cache: {
        read: 0,
        write: 0,
      },
    },
  },
  'session-external-bound': {
    sessionID: 'ses_1',
    provider: 'claude',
    directory: '/a',
  },
  'session-external-linked': {
    sessionID: 'ses_1',
    vendorSessionID: 'vendor_1',
  },
  'session-external-checkpointed': {
    sessionID: 'ses_1',
    checkpoint: 'checkpoint_1',
    historyHash: 'hash_1',
  },
  'worktree-resolved': {
    projectID: 'prj_1',
    directory: '/a',
    previous: 'global',
  },
  'project-created': {
    projectID: 'prj_1',
    canonical: '/a',
    vcs: 'git',
  },
  'project-vcs-changed': {
    projectID: 'prj_1',
    vcs: 'hg',
  },
  'project-relocated': {
    projectID: 'prj_1',
    canonical: '/b',
  },
  'project-edited': {
    projectID: 'prj_1',
    name: 'Routing',
    icon: { color: 'blue' },
    commands: { start: 'bun install' },
  },
  'worktree-recorded': {
    projectID: 'prj_1',
    directory: '/a/feature',
    strategy: 'git',
  },
  'worktree-removed': {
    projectID: 'prj_1',
    directory: '/a/feature',
  },
  'workspace-created': {
    workspaceID: 'wrk_1',
    provider: 'local',
    time: 1,
  },
  'workspace-bound': {
    workspaceID: 'wrk_1',
    binding: { sandbox: 'sbx_1' },
  },
  'workspace-used': {
    workspaceID: 'wrk_1',
    time: 2,
  },
  'workspace-destroyed': {
    workspaceID: 'wrk_1',
  },
} as const
