import { For, type JSX } from 'solid-js'

type Token = { text: string; cls: string }

const keywords = new Set([
  'import',
  'from',
  'export',
  'const',
  'let',
  'async',
  'await',
  'return',
  'throw',
  'if',
  'else',
  'new',
  'function',
  'type',
  'enum',
  'true',
  'false',
  'null',
])

const tokenPattern =
  /('(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*")|([A-Za-z_$][\w$]*)|(\d+\.?\d*)|(\s+)|([^\s])/g

function tokenizeSegment(segment: string): Token[] {
  const tokens: Token[] = []

  for (const match of segment.matchAll(tokenPattern)) {
    const [text, str, ident, num, space, punct] = match

    if (str !== undefined) {
      tokens.push({ text, cls: 'tok-str' })
    } else if (ident !== undefined) {
      if (keywords.has(ident)) {
        tokens.push({ text, cls: 'tok-kw' })
      } else if (/^[A-Z]/.test(ident)) {
        tokens.push({ text, cls: 'tok-type' })
      } else {
        tokens.push({ text, cls: 'tok-ident' })
      }
    } else if (num !== undefined) {
      tokens.push({ text, cls: 'tok-num' })
    } else if (space !== undefined) {
      tokens.push({ text, cls: 'tok-plain' })
    } else if (punct !== undefined) {
      tokens.push({ text, cls: 'tok-punct' })
    }
  }

  return tokens
}

function tokenizeLine(line: string): Token[] {
  const commentIndex = line.indexOf('//')

  if (commentIndex === -1) {
    return tokenizeSegment(line)
  }

  return [
    ...tokenizeSegment(line.slice(0, commentIndex)),
    { text: line.slice(commentIndex), cls: 'tok-comment' },
  ]
}

export function CodeBlock(props: {
  file: string
  lang: string
  code: string
}): JSX.Element {
  const lines = () => props.code.split('\n')

  return (
    <figure class="code-block">
      <figcaption class="code-chrome">
        <span class="code-dots" aria-hidden="true">
          <span class="dot dot-red" />
          <span class="dot dot-amber" />
          <span class="dot dot-green" />
        </span>
        <span class="code-file">{props.file}</span>
        <span class="code-lang">{props.lang}</span>
      </figcaption>
      <pre class="code-body">
        <code>
          <For each={lines()}>
            {(line) => (
              <span class="code-line">
                <For each={tokenizeLine(line)}>
                  {(token) => <span class={token.cls}>{token.text}</span>}
                </For>
                {'\n'}
              </span>
            )}
          </For>
        </code>
      </pre>
    </figure>
  )
}
