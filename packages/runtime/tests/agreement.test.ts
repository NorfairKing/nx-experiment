import { describe, expect, it } from 'vitest'
import { chunk } from '@nx-exp/collections'
import { randomExpression } from '@nx-exp/test-utils'
import { evaluate } from '../src/vm.js'

const sources = Array.from({ length: 300 }, (_, i) =>
  randomExpression(`agreement-${i}`, 24),
)

describe('evaluate against a reference interpreter', () => {
  it('agrees with JavaScript evaluation order on generated expressions', () => {
    for (const batch of chunk(sources, 25)) {
      for (const source of batch) {
        const reference: number = Function(`"use strict"; return (${source})`)()
        expect(evaluate(source)).toBeCloseTo(reference, 9)
      }
    }
  })

  it('is deterministic across repeated evaluation', () => {
    for (const source of sources.slice(0, 60)) {
      const first = evaluate(source)
      for (let i = 0; i < 25; i++) expect(evaluate(source)).toBe(first)
    }
  })
})
