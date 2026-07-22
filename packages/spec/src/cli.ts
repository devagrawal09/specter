#!/usr/bin/env node
import { spawn } from 'node:child_process'
import {
  lstat,
  mkdir,
  readFile,
  readdir,
  realpath,
  writeFile,
} from 'node:fs/promises'
import { dirname, extname, relative, resolve, sep } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { serializeSpecification } from './serialization.ts'
import { parseSpecification } from './validation.ts'

const [command, ...args] = process.argv.slice(2)

if (command === '__export-one') await exportOne(resolve(args[0] ?? ''))
else if (command === 'export') await exportInputs(args)
else {
  console.error('Usage: specter-spec export <file|directory|glob> [...]')
  process.exitCode = 1
}

async function exportInputs(inputs: readonly string[]) {
  if (!inputs.length)
    throw new Error(
      'At least one explicit file, directory, or glob is required.',
    )
  const files = await discover(inputs)
  if (!files.length)
    throw new Error('No spec.ts files matched the provided inputs.')
  for (const file of files) await isolatedExport(file)
}

async function discover(inputs: readonly string[]) {
  const files = new Set<string>()
  for (const input of inputs) {
    const absolute = resolve(input)
    try {
      const info = await lstat(absolute)
      if (info.isDirectory()) {
        for (const match of await walkSpecifications(absolute)) files.add(match)
      } else if (info.isFile()) files.add(await realpath(absolute))
    } catch {
      const root = globRoot(absolute)
      const match = globMatcher(absolute)
      for (const candidate of await walkSpecifications(root))
        if (match(candidate)) files.add(candidate)
    }
  }
  return [...files].filter((file) => file.endsWith('spec.ts')).sort()
}

async function isolatedExport(file: string) {
  await new Promise<void>((accept, reject) => {
    const child = spawn(
      process.execPath,
      [fileURLToPath(import.meta.url), '__export-one', file],
      {
        stdio: 'inherit',
        env: { ...process.env, SPECTER_SPEC_EXPORT_CHILD: '1' },
      },
    )
    child.once('error', reject)
    child.once('exit', (code) =>
      code === 0 ? accept() : reject(new Error(`Failed to export ${file}.`)),
    )
  })
}

async function walkSpecifications(directory: string): Promise<string[]> {
  const matches: string[] = []
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (
      entry.name === 'node_modules' ||
      entry.name === 'dist' ||
      entry.name.startsWith('.')
    )
      continue
    const path = resolve(directory, entry.name)
    if (entry.isDirectory()) matches.push(...(await walkSpecifications(path)))
    else if (entry.isFile() && entry.name === 'spec.ts') matches.push(path)
  }
  return matches
}

function globRoot(pattern: string) {
  const index = pattern.search(/[?*[]/)
  if (index < 0) return dirname(pattern)
  const prefix = pattern.slice(0, index)
  return resolve(prefix.endsWith(sep) ? prefix : dirname(prefix))
}

function globMatcher(pattern: string) {
  const parts = relative('/', pattern).split(sep)
  let escaped = ''
  for (const [index, part] of parts.entries()) {
    if (part === '**') {
      if (index > 0) escaped += '/'
      escaped += '(?:[^/]+/)*'
      continue
    }
    if (index > 0 && parts[index - 1] !== '**') escaped += '/'
    escaped += part
      .replace(/[.+^${}()|\\]/g, '\\$&')
      .replaceAll('*', '[^/]*')
      .replaceAll('?', '[^/]')
  }
  const expression = new RegExp(`^/${escaped}$`)
  return (path: string) => expression.test(path)
}

async function exportOne(file: string) {
  if (extname(file) !== '.ts')
    throw new Error(`Specification source must be TypeScript: ${file}`)
  const module = await import(
    `${pathToFileURL(file).href}?specter-export=${Date.now()}`
  )
  if (!Object.hasOwn(module, 'default'))
    throw new Error(
      `${file} must default-export exactly one Slice specification.`,
    )
  const specification = parseSpecification(module.default)
  const output = file.replace(/spec\.ts$/, 'spec.json')
  await mkdir(dirname(output), { recursive: true })
  const next = serializeSpecification(specification)
  const current = await readFile(output, 'utf8').catch(() => undefined)
  if (current !== next) await writeFile(output, next)
  console.log(output)
}
