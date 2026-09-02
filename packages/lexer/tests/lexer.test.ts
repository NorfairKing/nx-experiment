import { describe, expect, it } from 'vitest'
import { describeToken } from '@nx-exp/tokens'
import { normalizeName, tokenize } from '../src/lexer.js'

describe('tokenize', () => {
  it('splits an arithmetic expression into kinds', () => {
    expect(tokenize('1 + 23 * x').map((t) => t.kind)).toEqual([
      'number',
      'operator',
      'number',
      'operator',
      'identifier',
    ])
  })

  it('records the source offset of each token', () => {
    expect(tokenize('12 + 3').map(describeToken)).toEqual([
      'number(12)@0',
      'operator(+)@3',
      'number(3)@5',
    ])
  })

  it('ignores whitespace runs', () => {
    expect(tokenize('  1\t+\n2  ').length).toBe(3)
  })

  it('handles nested parentheses', () => {
    expect(tokenize('((1))').map((t) => t.kind)).toEqual([
      'lparen',
      'lparen',
      'number',
      'rparen',
      'rparen',
    ])
  })

  it('rejects an unexpected character', () => {
    expect(() => tokenize('1 $ 2')).toThrow(SyntaxError)
  })
})

describe('normalizeName', () => {
  it('lowercases and underscores mixed-case names', () => {
    expect(normalizeName('TotalCount')).toBe('totalcount')
  })

  it('keeps an already normal name unchanged', () => {
    expect(normalizeName('total_count')).toBe('total_count')
  })
})
