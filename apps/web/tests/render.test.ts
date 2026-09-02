import { describe, expect, it } from 'vitest'
import { escapeHtml, renderExpression, renderList } from '../src/render.js'

describe('escapeHtml', () => {
  it('escapes the four markup-significant characters', () => {
    expect(escapeHtml('a & b < c > d "e"')).toBe(
      'a &amp; b &lt; c &gt; d &quot;e&quot;',
    )
  })

  it('leaves plain text untouched', () => {
    expect(escapeHtml('1 + 2 * 3')).toBe('1 + 2 * 3')
  })
})

describe('renderExpression', () => {
  it('renders the value inside an output element', () => {
    expect(renderExpression('1 + 2 * 3')).toContain('<output>7</output>')
  })

  it('gives each expression a stable slug id', () => {
    expect(renderExpression('1 + 1')).toBe(renderExpression('1 + 1'))
  })

  it('marks a failing expression instead of throwing', () => {
    const html = renderExpression('1 +')
    expect(html).toContain('class="failed"')
    expect(html).toContain('<span>unexpected end of input</span>')
  })

  it('truncates a long source in the label', () => {
    const html = renderExpression('1 + 2 + 3 + 4 + 5 + 6 + 7 + 8 + 9')
    expect(html).toContain('<code>1 + 2 + 3 + 4 + 5 + 6 +…</code>')
  })
})

describe('renderList', () => {
  it('wraps one item per source', () => {
    const html = renderList(['1 + 1', '2 * 2'])
    expect(html.startsWith('<ul>')).toBe(true)
    expect(html.endsWith('</ul>')).toBe(true)
    expect(html.match(/<li /g)?.length).toBe(2)
  })

  it('renders an empty list for no sources', () => {
    expect(renderList([])).toBe('<ul></ul>')
  })
})
