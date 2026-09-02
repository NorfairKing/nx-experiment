import { describe, expect, it } from 'vitest'
import { padCenter, truncate } from '../src/pad.js'

describe('padCenter', () => {
  it('biases the extra character to the right', () => {
    expect(padCenter('ab', 5, '.')).toBe('.ab..')
  })

  it('leaves input wider than the target untouched', () => {
    expect(padCenter('abcdef', 3, '.')).toBe('abcdef')
  })

  it('always reaches the requested width', () => {
    const widths = Array.from({ length: 64 }, (_, i) =>
      padCenter('xy', i, '-').length,
    )
    expect(widths).toEqual(
      Array.from({ length: 64 }, (_, i) => Math.max(i, 2)),
    )
  })
})

describe('truncate', () => {
  it('replaces the final character with an ellipsis', () => {
    expect(truncate('abcdef', 4)).toBe('abc…')
  })

  it('never exceeds the requested width', () => {
    const inputs = ['', 'a', 'ab', 'abcdefghij']
    for (const input of inputs) {
      for (let w = 0; w < 6; w++) {
        expect(truncate(input, w).length).toBeLessThanOrEqual(Math.max(w, 0))
      }
    }
  })
})
