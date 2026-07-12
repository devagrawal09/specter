export type PermissionAction = "allow" | "ask" | "deny"

export type PermissionRule = {
  permission: string
  pattern: string
  action: PermissionAction
}

export type PermissionRequest = {
  permission: string
  target: string
}

export type PermissionDecision = {
  action: PermissionAction
  rule?: PermissionRule
}

const REGEXP_SPECIAL_CHARACTERS = new Set([
  "\\",
  ".",
  "+",
  "?",
  "^",
  "$",
  "{",
  "}",
  "(",
  ")",
  "|",
  "[",
  "]",
])

function normalizeMatchValue(value: string) {
  return value.trim().replaceAll("\\", "/")
}

function escapeRegExpCharacter(character: string) {
  return REGEXP_SPECIAL_CHARACTERS.has(character) ? "\\" + character : character
}

function wildcardPatternToRegExp(pattern: string) {
  let expression = ""

  for (let index = 0; index < pattern.length; index += 1) {
    const character = pattern[index]
    if (character === "*") {
      if (pattern[index + 1] === "*") {
        expression += ".*"
        index += 1
      } else {
        expression += ".*"
      }
      continue
    }

    if (character === "?") {
      expression += "."
      continue
    }

    expression += escapeRegExpCharacter(character)
  }

  return new RegExp(`^${expression}$`)
}

function wildcardMatches(pattern: string, value: string) {
  return wildcardPatternToRegExp(normalizeMatchValue(pattern)).test(
    normalizeMatchValue(value),
  )
}

export function evaluatePermission(
  rules: readonly PermissionRule[],
  request: PermissionRequest,
): PermissionDecision {
  for (let index = rules.length - 1; index >= 0; index -= 1) {
    const rule = rules[index]
    if (
      wildcardMatches(rule.permission, request.permission) &&
      wildcardMatches(rule.pattern, request.target)
    ) {
      return { action: rule.action, rule }
    }
  }

  return { action: "ask" }
}
