import { cpSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const canonicalSkill = resolve(
  repositoryRoot,
  '.agents/skills/specter/SKILL.md',
)
const targets = [
  'apps/booking-reference/.agents/skills/specter/SKILL.md',
  'apps/narayan-ai/.agents/skills/specter/SKILL.md',
  'apps/reference/.agents/skills/specter/SKILL.md',
  'apps/specter-code/.agents/skills/specter/SKILL.md',
  'apps/threadplane-reference/.agents/skills/specter/SKILL.md',
  'packages/create-specter/template/.agents/skills/specter/SKILL.md',
]

const expected = readFileSync(canonicalSkill, 'utf8')
const checkOnly = process.argv.includes('--check')
const drifted = []

for (const target of targets) {
  const absoluteTarget = resolve(repositoryRoot, target)

  if (checkOnly) {
    if (readFileSync(absoluteTarget, 'utf8') !== expected) drifted.push(target)
    continue
  }

  cpSync(canonicalSkill, absoluteTarget)
}

if (drifted.length > 0) {
  throw new Error(
    `Specter Agent Skill copies have drifted:\n${drifted.map((path) => `- ${path}`).join('\n')}`,
  )
}
