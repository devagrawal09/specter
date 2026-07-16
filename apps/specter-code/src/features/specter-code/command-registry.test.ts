import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import {
  listSpecterCodeCommands,
  renderSpecterCodeCommandPrompt,
} from './adapters/command-registry'

let workspaceRoot: string

describe('OpenCode command registry', () => {
  beforeEach(async () => {
    workspaceRoot = await mkdtemp(
      path.join(os.tmpdir(), 'specter-code-commands-'),
    )
    await mkdir(path.join(workspaceRoot, '.opencode', 'commands'), {
      recursive: true,
    })
    await mkdir(
      path.join(workspaceRoot, '.opencode', 'skills', 'review-local'),
      {
        recursive: true,
      },
    )

    await writeFile(
      path.join(workspaceRoot, '.opencode', 'opencode.jsonc'),
      JSON.stringify(
        {
          command: {
            commit: {
              description: 'Draft a commit message',
              agent: 'build',
              model: 'openrouter/test-model',
              subtask: true,
              template: 'Commit the current changes: $ARGUMENTS',
            },
          },
        },
        null,
        2,
      ),
    )

    await writeFile(
      path.join(workspaceRoot, '.opencode', 'commands', 'fix.md'),
      [
        '---',
        'description: Fix a named file',
        'agent: plan',
        'model: anthropic/claude-sonnet-4',
        'subtask: true',
        '---',
        'Fix $1 and explain $ARGUMENTS',
      ].join('\n'),
    )

    await writeFile(
      path.join(
        workspaceRoot,
        '.opencode',
        'skills',
        'review-local',
        'SKILL.md',
      ),
      [
        '---',
        'name: review-local',
        'description: Review local code changes',
        '---',
        'Review the local diff and report risks.',
      ].join('\n'),
    )
  })

  afterEach(async () => {
    await rm(workspaceRoot, { recursive: true, force: true })
  })

  it('lists built-in, config, markdown, and skill commands with OpenCode hints', async () => {
    const commands = await listSpecterCodeCommands({ workspaceRoot })

    expect(commands).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: 'init',
          source: 'command',
          hints: [],
        }),
        expect.objectContaining({
          name: 'review',
          source: 'command',
          subtask: true,
        }),
        {
          name: 'commit',
          description: 'Draft a commit message',
          agent: 'build',
          model: 'openrouter/test-model',
          source: 'command',
          template: 'Commit the current changes: $ARGUMENTS',
          subtask: true,
          hints: ['$ARGUMENTS'],
        },
        {
          name: 'fix',
          description: 'Fix a named file',
          agent: 'plan',
          model: 'anthropic/claude-sonnet-4',
          source: 'command',
          template: 'Fix $1 and explain $ARGUMENTS',
          subtask: true,
          hints: ['$1', '$ARGUMENTS'],
        },
        {
          name: 'review-local',
          description: 'Review local code changes',
          source: 'skill',
          template: 'Review the local diff and report risks.',
          hints: [],
        },
      ]),
    )
    expect(commands.map((command) => command.name)).toEqual(
      [...commands.map((command) => command.name)].sort(),
    )
  })

  it('renders command templates using positional arguments and the full argument string', async () => {
    const commands = await listSpecterCodeCommands({ workspaceRoot })
    const fix = commands.find((command) => command.name === 'fix')
    expect(fix).toBeDefined()

    expect(
      renderSpecterCodeCommandPrompt(
        fix!,
        'src/app.ts with regression coverage',
      ),
    ).toBe('Fix src/app.ts and explain src/app.ts with regression coverage')
  })
})
