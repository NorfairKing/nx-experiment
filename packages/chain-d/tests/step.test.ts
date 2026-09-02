import { describe, expect, it } from 'vitest'
import { step } from '../src/index.js'

describe('step', () => {
  it('doubles and offsets by one', () => {
    expect([0, 1, 2, 5].map(step)).toEqual([1, 3, 5, 11])
  })

  it('always produces an odd number from an integer', () => {
    expect(
      Array.from({ length: 100 }, (_, i) => step(i)).every((n) => n % 2 === 1),
    ).toBe(true)
  })
})
