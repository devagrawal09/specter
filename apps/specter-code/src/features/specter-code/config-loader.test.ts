import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { loadSpecterCodeConfig } from './adapters/config-loader'

let workspaceRoot: string
let globalConfigDir: string

async function writeJsonc(filePath: string, content: string) {
  await mkdir(path.dirname(filePath), { recursive: true })
  await writeFile(filePath, content)
}

beforeEach(async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'specter-code-config-'))
  workspaceRoot = path.join(root, 'workspace')
  globalConfigDir = path.join(root, 'global')
  await mkdir(workspaceRoot, { recursive: true })
  await mkdir(globalConfigDir, { recursive: true })
})

afterEach(async () => {
  await rm(path.dirname(workspaceRoot), { recursive: true, force: true })
})

describe('loadSpecterCodeConfig', () => {
  it('loads OpenCode JSONC sources using project override precedence', async () => {
    await writeJsonc(
      path.join(globalConfigDir, 'opencode.jsonc'),
      `{
        // global defaults should survive unless a project overrides them
        "shell": "/bin/zsh",
        "model": "openai/gpt-4.1",
        "provider": {
          "openai": { "models": { "gpt-4.1": { "name": "GPT 4.1" } } }
        },
        "agent": {
          "build": { "description": "Global build agent", "tools": { "read": true } }
        },
      }`,
    )
    await writeJsonc(
      path.join(workspaceRoot, 'opencode.jsonc'),
      `{
        "model": "anthropic/claude-sonnet-4",
        "agent": {
          "build": { "prompt": "Prefer tests first." },
          "review": { "description": "Review code" }
        }
      }`,
    )
    await writeJsonc(
      path.join(workspaceRoot, '.opencode', 'opencode.jsonc'),
      `{
        "default_agent": "review",
        "plugin": ["./plugin.ts"],
        "skills": ["./skills"],
        "mcp": { "docs": { "type": "local", "command": ["node", "server.js"] } },
        "watcher": { "ignore": ["dist/**"] }
      }`,
    )

    await expect(
      loadSpecterCodeConfig({ workspaceRoot, globalConfigDir }),
    ).resolves.toMatchObject({
      model: { providerId: 'anthropic', modelId: 'claude-sonnet-4' },
      shell: '/bin/zsh',
      defaultAgent: 'review',
      provider: {
        openai: { models: { 'gpt-4.1': { name: 'GPT 4.1' } } },
      },
      agent: {
        build: {
          description: 'Global build agent',
          prompt: 'Prefer tests first.',
          tools: { read: true },
        },
        review: { description: 'Review code' },
      },
      plugin: [path.join(workspaceRoot, '.opencode', 'plugin.ts')],
      skills: [path.join(workspaceRoot, '.opencode', 'skills')],
      mcp: { docs: { type: 'local', command: ['node', 'server.js'] } },
      watcher: { ignore: ['dist/**'] },
      sources: [
        path.join(globalConfigDir, 'opencode.jsonc'),
        path.join(workspaceRoot, 'opencode.jsonc'),
        path.join(workspaceRoot, '.opencode', 'opencode.jsonc'),
      ],
    })
  })

  it('normalizes OpenCode permission config to ordered Specter Code rules', async () => {
    await writeJsonc(
      path.join(globalConfigDir, 'opencode.jsonc'),
      `{
        "permission": {
          "read": "allow",
          "edit": { "src/**": "ask" }
        }
      }`,
    )
    await writeJsonc(
      path.join(workspaceRoot, '.opencode', 'opencode.jsonc'),
      `{
        "permission": {
          "bash": { "pnpm test": "allow" },
          "edit": { "src/secrets/**": "deny" },
          "webfetch": "ask"
        }
      }`,
    )

    const config = await loadSpecterCodeConfig({ workspaceRoot, globalConfigDir })

    expect(config.permissionRules).toEqual([
      { permission: 'file.read', pattern: '*', action: 'allow' },
      { permission: 'file.write', pattern: 'src/**', action: 'ask' },
      { permission: 'shell.execute', pattern: 'pnpm test', action: 'allow' },
      { permission: 'file.write', pattern: 'src/secrets/**', action: 'deny' },
      { permission: 'web.fetch', pattern: '*', action: 'ask' },
    ])
  })

  it('applies OPENCODE_CONFIG_CONTENT after file sources', async () => {
    await writeJsonc(
      path.join(workspaceRoot, 'opencode.jsonc'),
      `{
        "model": "anthropic/claude-sonnet-4",
        "permission": { "bash": "ask" }
      }`,
    )

    await expect(
      loadSpecterCodeConfig({
        workspaceRoot,
        globalConfigDir,
        env: {
          OPENCODE_CONFIG_CONTENT: `{
            "model": "openrouter/deepseek-chat",
            "permission": { "bash": "deny" }
          }`,
        },
      }),
    ).resolves.toMatchObject({
      model: { providerId: 'openrouter', modelId: 'deepseek-chat' },
      permissionRules: [
        { permission: 'shell.execute', pattern: '*', action: 'ask' },
        { permission: 'shell.execute', pattern: '*', action: 'deny' },
      ],
      sources: [
        path.join(workspaceRoot, 'opencode.jsonc'),
        'OPENCODE_CONFIG_CONTENT',
      ],
    })
  })
})
