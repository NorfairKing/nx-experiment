import { describe, expect, it } from 'vitest'
import { sumTwice } from '../src/index.js'

describe('sumTwice', () => {
  it('is zero over an empty range', () => {
    expect(sumTwice(0)).toBe(0)
  })

  it('matches the closed form 2n^2 + n', () => {
    for (let n = 0; n < 50; n++) {
      expect(sumTwice(n)).toBe(2 * n * n + n)
    }
  })
})
