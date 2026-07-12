import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { listSpecterCodeSkills } from './adapters/skills'

let workspaceRoot: string

beforeEach(async () => {
  workspaceRoot = await mkdtemp(path.join(os.tmpdir(), 'specter-code-skills-'))
})

afterEach(async () => {
  await rm(workspaceRoot, { recursive: true, force: true })
})

describe('Specter Code skill registry', () => {
  it('loads OpenCode SKILL.md files from project and configured skill paths', async () => {
    await mkdir(path.join(workspaceRoot, '.opencode', 'skills', 'review'), { recursive: true })
    await mkdir(path.join(workspaceRoot, 'custom-skills', 'planning'), { recursive: true })
    await writeFile(
      path.join(workspaceRoot, '.opencode', 'skills', 'review', 'SKILL.md'),
      [
        '---',
        'name: review',
        'description: Review local code changes',
        '---',
        '',
        '# Review',
        '',
        'Inspect diffs and produce actionable feedback.',
        '',
      ].join('\n'),
    )
    await writeFile(
      path.join(workspaceRoot, 'custom-skills', 'planning', 'SKILL.md'),
      [
        '---',
        'name: planning',
        '---',
        '',
        '# Planning',
        '',
        'Break large requests into milestones.',
        '',
      ].join('\n'),
    )
    await writeFile(
      path.join(workspaceRoot, 'opencode.jsonc'),
      JSON.stringify({ skills: { paths: ['./custom-skills'] } }),
    )

    const skills = await listSpecterCodeSkills({ workspaceRoot })

    expect(skills.map((skill) => skill.name)).toEqual(['planning', 'review'])
    expect(skills[0]).toEqual({
      name: 'planning',
      location: path.join(workspaceRoot, 'custom-skills', 'planning', 'SKILL.md'),
      content: '# Planning\n\nBreak large requests into milestones.\n',
    })
    expect(skills[1]).toEqual({
      name: 'review',
      description: 'Review local code changes',
      location: path.join(workspaceRoot, '.opencode', 'skills', 'review', 'SKILL.md'),
      content: '# Review\n\nInspect diffs and produce actionable feedback.\n',
    })
  })
})
