import { describe, expect, it } from 'vitest'
import { apply, evaluate, execute } from '../src/vm.js'

describe('apply', () => {
  it('implements the four operators', () => {
    expect([
      apply('+', 6, 3),
      apply('-', 6, 3),
      apply('*', 6, 3),
      apply('/', 6, 3),
    ]).toEqual([9, 3, 18, 2])
  })

  it('rejects division by zero', () => {
    expect(() => apply('/', 1, 0)).toThrow(RangeError)
  })

  it('rejects an unknown operator', () => {
    expect(() => apply('%', 1, 2)).toThrow(SyntaxError)
  })
})

describe('execute', () => {
  it('evaluates a postfix instruction sequence', () => {
    expect(
      execute([
        { op: 'push', value: 2 },
        { op: 'push', value: 5 },
        { op: 'apply', operator: '*' },
      ]),
    ).toBe(10)
  })

  it('reads names from the environment', () => {
    expect(execute([{ op: 'load', name: 'x' }], { x: 11 })).toBe(11)
  })

  it('rejects an unbound name', () => {
    expect(() => execute([{ op: 'load', name: 'nope' }])).toThrow(ReferenceError)
  })

  it('rejects a stack underflow', () => {
    expect(() => execute([{ op: 'apply', operator: '+' }])).toThrow(RangeError)
  })

  it('rejects a leftover value', () => {
    expect(() =>
      execute([
        { op: 'push', value: 1 },
        { op: 'push', value: 2 },
      ]),
    ).toThrow(RangeError)
  })
})

describe('evaluate', () => {
  it('respects operator precedence end to end', () => {
    expect(evaluate('1 + 2 * 3')).toBe(7)
    expect(evaluate('(1 + 2) * 3')).toBe(9)
  })

  it('resolves identifiers through the environment', () => {
    expect(evaluate('base * 2 + 1', { base: 20 })).toBe(41)
  })
})
