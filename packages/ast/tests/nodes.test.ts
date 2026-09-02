import { describe, expect, it } from 'vitest'
import { makeToken } from '@nx-exp/tokens'
import {
  binaryNode,
  identifierNode,
  leafFromToken,
  numberNode,
} from '../src/nodes.js'

describe('node constructors', () => {
  it('tags a number node', () => {
    expect(numberNode(4)).toEqual({ kind: 'number', value: 4 })
  })

  it('tags an identifier node', () => {
    expect(identifierNode('x')).toEqual({ kind: 'identifier', name: 'x' })
  })

  it('nests operands under a binary node', () => {
    expect(binaryNode('+', numberNode(1), identifierNode('y'))).toEqual({
      kind: 'binary',
      op: '+',
      left: { kind: 'number', value: 1 },
      right: { kind: 'identifier', name: 'y' },
    })
  })
})

describe('leafFromToken', () => {
  it('converts a number token to a number node', () => {
    expect(leafFromToken(makeToken('number', '42', 0))).toEqual({
      kind: 'number',
      value: 42,
    })
  })

  it('converts an identifier token to an identifier node', () => {
    expect(leafFromToken(makeToken('identifier', 'total', 3))).toEqual({
      kind: 'identifier',
      name: 'total',
    })
  })

  it('rejects a token that cannot be a leaf', () => {
    for (const kind of ['operator', 'lparen', 'rparen'] as const) {
      expect(() => leafFromToken(makeToken(kind, '(', 0))).toThrow(SyntaxError)
    }
  })
})
