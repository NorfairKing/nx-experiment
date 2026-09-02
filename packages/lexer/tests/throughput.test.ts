import { describe, expect, it } from 'vitest'
import { randomExpression } from '@nx-exp/test-utils'
import { tokenize } from '../src/lexer.js'

describe('tokenize throughput', () => {
  it('tokenizes many large expressions consistently', () => {
    let total = 0
    for (let i = 0; i < 400; i++) {
      const source = randomExpression(`throughput-${i}`, 200)
      const tokens = tokenize(source)
      expect(tokens.length).toBe(399)
      total += tokens.length
    }
    expect(total).toBe(400 * 399)
  })

  it('is stable across repeated runs of the same input', () => {
    const source = randomExpression('stability', 400)
    const first = tokenize(source).map((t) => t.id)
    for (let i = 0; i < 200; i++) {
      expect(tokenize(source).map((t) => t.id)).toEqual(first)
    }
  })
})
