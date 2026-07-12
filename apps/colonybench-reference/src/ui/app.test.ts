import { describe, expect, test } from 'vitest'

import { escapeHtml } from './app'

describe('ColonyBench UI escaping', () => {
  test('escapes text and attribute quote characters before rendering bot-provided labels', () => {
    expect(escapeHtml('role "builder" & <script>\'')).toBe(
      'role &quot;builder&quot; &amp; &lt;script&gt;&#39;',
    )
  })
})
