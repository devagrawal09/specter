import { CodeMode, Tool } from '@ocpp/codemode'
import { Effect, Schema } from 'effect'

import type { ToolSpec } from './model.ts'

// The one model-visible tool: `execute` runs a Code Mode program over a small,
// explicit set of host tools. Everything the program can do is in `provided`;
// the limits bound one execution (OC++ also bounds steps; see the findings).
export const EXECUTE_TOOL = 'execute'

const provided = {
  echo: Tool.make({
    description: 'Returns its input text unchanged.',
    input: Schema.Struct({ text: Schema.String }),
    output: Schema.Struct({ text: Schema.String }),
    execute: ({ text }) => Effect.succeed({ text }),
  }),
}

export const executeLimits = {
  timeoutMs: 5_000,
  maxToolCalls: 10,
  maxOutputBytes: 16_384,
} as const

export const executeToolSpec: ToolSpec = {
  name: EXECUTE_TOOL,
  description:
    'Run a JavaScript program. Available host tools: `tools.echo({ text })` returns `{ text }`. Return the final value with `return`.',
  inputSchema: {
    type: 'object',
    properties: {
      code: { type: 'string', description: 'The program source.' },
    },
    required: ['code'],
    additionalProperties: false,
  },
}

export type ToolSettlement =
  | { readonly ok: true; readonly text: string }
  | { readonly ok: false; readonly error: { type: string; message: string } }

const decodeInput = Schema.decodeUnknownOption(CodeMode.Input)

// Runs one tool call to a settlement. A program failure is data (a failed
// tool result the model can read), never an Effect failure.
export const runTool = (
  name: string,
  input: Record<string, unknown>,
  hostTools: Record<string, Tool.Tool> = {},
): Effect.Effect<ToolSettlement> =>
  Effect.gen(function* () {
    if (name !== EXECUTE_TOOL)
      return {
        ok: false,
        error: { type: 'tool.unknown', message: `Unknown tool: ${name}` },
      } as const
    const decoded = decodeInput(input)
    if (decoded._tag === 'None')
      return {
        ok: false,
        error: {
          type: 'tool.input',
          message: 'execute needs { code: string }',
        },
      } as const
    const result = yield* CodeMode.execute({
      code: decoded.value.code,
      tools: { ...provided, ...hostTools },
      limits: executeLimits,
    })
    if (!result.ok)
      return {
        ok: false,
        error: {
          type: 'tool.execution',
          message: `${result.error.kind}: ${result.error.message}`,
        },
      } as const
    return {
      ok: true,
      text:
        typeof result.value === 'string'
          ? result.value
          : (JSON.stringify(result.value) ?? 'null'),
    } as const
  })
