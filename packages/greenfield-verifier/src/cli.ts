#!/usr/bin/env node

import { readFile, writeFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'
import { resolve } from 'node:path'
import {
  stringifyVerificationResult,
  verifyGreenfieldAttempt,
} from './runner.js'
import { parseVerificationPlan } from './validation.js'
import type { GreenfieldDriver, GreenfieldDriverFactory } from './types.js'

interface CliArguments {
  config: string
  driver: string
  output?: string
  remediation: boolean
}

const usage = `Usage:
  specter-greenfield-verify --config <plan.json> --driver <driver.mjs> [--output <result.json>] [--remediation]

Driver modules must export createGreenfieldDriver(plan), either as a named export
or as their default export. The coordinator driver owns frozen checks and calls
the app's frozen semantic adapter; app code must not receive held-out check IDs.`

function parseArguments(argv: readonly string[]): CliArguments {
  let config: string | undefined
  let driver: string | undefined
  let output: string | undefined
  let remediation = false
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]
    if (argument === '--help' || argument === '-h') {
      process.stdout.write(`${usage}\n`)
      process.exit(0)
    }
    if (argument === '--remediation') {
      remediation = true
      continue
    }
    if (
      argument === '--config' ||
      argument === '--driver' ||
      argument === '--output'
    ) {
      const value = argv[index + 1]
      if (value === undefined || value.startsWith('--')) {
        throw new Error(`${argument} requires a path\n\n${usage}`)
      }
      index += 1
      if (argument === '--config') config = value
      if (argument === '--driver') driver = value
      if (argument === '--output') output = value
      continue
    }
    throw new Error(`unknown argument: ${argument}\n\n${usage}`)
  }
  if (config === undefined || driver === undefined) {
    throw new Error(`--config and --driver are required\n\n${usage}`)
  }
  return { config, driver, output, remediation }
}

function driverFactoryFrom(
  module: Record<string, unknown>,
): GreenfieldDriverFactory {
  const candidate = module.createGreenfieldDriver ?? module.default
  if (typeof candidate !== 'function') {
    throw new Error(
      'driver module must export a createGreenfieldDriver(plan) function or a default factory',
    )
  }
  return candidate as GreenfieldDriverFactory
}

async function main(): Promise<void> {
  const args = parseArguments(process.argv.slice(2))
  const configPath = resolve(args.config)
  const driverPath = resolve(args.driver)
  const rawPlan: unknown = JSON.parse(await readFile(configPath, 'utf8'))
  const plan = parseVerificationPlan(rawPlan)
  const driverModule = (await import(pathToFileURL(driverPath).href)) as Record<
    string,
    unknown
  >
  const driver = (await driverFactoryFrom(driverModule)(
    plan,
  )) as GreenfieldDriver
  if (
    typeof driver?.setup !== 'function' ||
    typeof driver?.runCheck !== 'function' ||
    typeof driver?.teardown !== 'function'
  ) {
    throw new Error(
      'driver factory must return setup(context), runCheck(context), and teardown(context)',
    )
  }
  const result = await verifyGreenfieldAttempt(plan, driver, {
    runRemediation: args.remediation,
  })
  const json = stringifyVerificationResult(result)
  if (args.output === undefined) {
    process.stdout.write(json)
  } else {
    await writeFile(resolve(args.output), json, 'utf8')
  }
  if (!result.fullFirstAttemptSuccess) process.exitCode = 1
}

main().catch((error: unknown) => {
  process.stderr.write(
    `${error instanceof Error ? error.message : String(error)}\n`,
  )
  process.exitCode = 2
})
