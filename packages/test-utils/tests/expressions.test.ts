import { describe, expect, it } from 'vitest'
import { randomExpression } from '../src/expressions.js'

describe('randomExpression', () => {
  it('is stable for a given seed and term count', () => {
    expect(randomExpression('seed', 4)).toBe(randomExpression('seed', 4))
  })

  it('alternates operands and operators', () => {
    const parts = randomExpression('layout', 5).split(' ')
    expect(parts.length).toBe(9)
    expect(parts.filter((_, i) => i % 2 === 0).every((p) => /^\d+$/.test(p))).toBe(
      true,
    )
    expect(
      parts.filter((_, i) => i % 2 === 1).every((p) => '+-*/'.includes(p)),
    ).toBe(true)
  })

  it('never emits a zero operand, so division stays defined', () => {
    for (let i = 0; i < 40; i++) {
      const operands = randomExpression(`seed-${i}`, 8)
        .split(' ')
        .filter((_, j) => j % 2 === 0)
      expect(operands.includes('0')).toBe(false)
    }
  })
})
