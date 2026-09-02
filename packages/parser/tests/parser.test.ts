import { describe, expect, it } from 'vitest'
import { render } from '@nx-exp/ast'
import { parse } from '../src/parser.js'

describe('parse', () => {
  it('reads a bare number', () => {
    expect(parse('42')).toEqual({ kind: 'number', value: 42 })
  })

  it('binds multiplication tighter than addition', () => {
    expect(render(parse('1 + 2 * 3'))).toBe('(1 + (2 * 3))')
  })

  it('lets parentheses override precedence', () => {
    expect(render(parse('(1 + 2) * 3'))).toBe('((1 + 2) * 3)')
  })

  it('associates same-precedence operators to the left', () => {
    expect(render(parse('1 - 2 - 3'))).toBe('((1 - 2) - 3)')
  })

  it('accepts normalized identifiers from the lexer', () => {
    expect(parse('TotalCount')).toEqual({
      kind: 'identifier',
      name: 'totalcount',
    })
  })

  it('rejects an unclosed parenthesis', () => {
    expect(() => parse('(1 + 2')).toThrow(SyntaxError)
  })

  it('rejects a trailing operator', () => {
    expect(() => parse('1 +')).toThrow(SyntaxError)
  })

  it('rejects trailing junk after a complete expression', () => {
    expect(() => parse('1 2')).toThrow(SyntaxError)
  })
})
