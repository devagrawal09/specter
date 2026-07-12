type DemoTuiEvent =
  | {
      type: 'session.created'
      sessionId: string
      title: string
      directory: string
    }
  | {
      type: 'message.created'
      role: 'user'
      content: string
    }
  | {
      type: 'run.started'
      runId: string
      agentId: string
      agentName: string
      model: string
      modelConfigured: boolean
    }
  | {
      type: 'tool.started'
      toolName: string
      inputSummary: string
    }
  | {
      type: 'tool.completed'
      toolName: string
      outputSummary: string
    }
  | {
      type: 'tool.failed'
      toolName: string
      error: string
    }
  | {
      type: 'assistant.delta'
      delta: string
    }
  | {
      type: 'assistant.message'
      role: 'assistant'
      content: string
    }
  | {
      type: 'run.completed'
      runId: string
    }
  | {
      type: 'run.failed'
      runId: string
      error: string
    }

type DemoTuiOptions = {
  cwd: string
  prompt: string
}

export function renderInteractiveDemoTui(
  events: readonly DemoTuiEvent[],
  options: DemoTuiOptions,
) {
  const session = events.find((event) => event.type === 'session.created')
  const run = events.find((event) => event.type === 'run.started')
  const userMessage = events.find((event) => event.type === 'message.created')
  const assistantMessage = events.find((event) => event.type === 'assistant.message')
  const startedTool = events.find((event) => event.type === 'tool.started')
  const completedTool = events.find((event) => event.type === 'tool.completed')
  const failedTool = events.find((event) => event.type === 'tool.failed')
  const failedRun = events.find((event) => event.type === 'run.failed')

  const toolName = startedTool?.type === 'tool.started' ? startedTool.toolName : 'tool'
  const transcriptLines = [
    'Session transcript',
    `You: ${userMessage?.type === 'message.created' ? userMessage.content : options.prompt}`,
  ]

  if (assistantMessage?.type === 'assistant.message') {
    transcriptLines.push(`Assistant: ${assistantMessage.content}`)
  } else if (failedRun?.type === 'run.failed') {
    transcriptLines.push(`Assistant: Run failed: ${failedRun.error}`)
  } else {
    const streamed = events
      .filter((event): event is Extract<DemoTuiEvent, { type: 'assistant.delta' }> =>
        event.type === 'assistant.delta',
      )
      .map((event) => event.delta)
      .join('')
    if (streamed) transcriptLines.push(`Assistant: ${streamed}`)
  }

  const toolStatus = failedTool?.type === 'tool.failed'
    ? `failed: ${failedTool.error}`
    : completedTool?.type === 'tool.completed'
      ? `completed: ${completedTool.outputSummary}`
      : startedTool?.type === 'tool.started'
        ? `running: ${startedTool.inputSummary}`
        : 'waiting'

  return [
    'Specter Code TUI',
    `Workspace: ${session?.type === 'session.created' ? session.directory : options.cwd}`,
    `Session: ${session?.type === 'session.created' ? session.title : 'Interactive demo'}`,
    `Agent: ${run?.type === 'run.started' ? run.agentName : 'Build Agent'}`,
    `Model: ${run?.type === 'run.started' ? run.model : 'default'}`,
    '',
    ...transcriptLines,
    '',
    'Tool timeline',
    `${toolName}: ${toolStatus}`,
    '',
    'Approval required',
    `Permission: tool.execute.${toolName}`,
    `Target: ${toolName} on ${options.cwd}`,
    'Approve [a]  Reject [r]',
    '',
    `Prompt: ${options.prompt}`,
  ].join('\n') + '\n'
}
