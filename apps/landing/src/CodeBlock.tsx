import type { JSX } from 'solid-js'

export type CodeBlockProps = {
  label: string
  tag?: string
  code: string
  tone?: 'source' | 'output'
}

export function CodeBlock(props: CodeBlockProps): JSX.Element {
  return (
    <figure class="code" data-tone={props.tone ?? 'source'}>
      <figcaption class="code__bar">
        <span class="code__dots" aria-hidden="true">
          <i />
          <i />
          <i />
        </span>
        <span class="code__label">{props.label}</span>
        {props.tag ? <span class="code__tag">{props.tag}</span> : null}
      </figcaption>
      <pre class="code__body">
        <code>{props.code}</code>
      </pre>
    </figure>
  )
}
