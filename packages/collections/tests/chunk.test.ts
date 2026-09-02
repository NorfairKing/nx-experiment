import { describe, expect, it } from 'vitest'
import { chunk, uniqueByHash } from '../src/chunk.js'

describe('chunk', () => {
  it('splits into equal parts when the size divides evenly', () => {
    expect(chunk([1, 2, 3, 4], 2)).toEqual([
      [1, 2],
      [3, 4],
    ])
  })

  it('leaves a short final chunk', () => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]])
  })

  it('rejects a non-positive size', () => {
    expect(() => chunk([1], 0)).toThrow(RangeError)
  })

  it('preserves every element across chunk sizes', () => {
    const items = Array.from({ length: 97 }, (_, i) => i)
    for (let size = 1; size <= 20; size++) {
      expect(chunk(items, size).flat()).toEqual(items)
    }
  })
})

describe('uniqueByHash', () => {
  it('keeps the first occurrence of each value', () => {
    expect(uniqueByHash(['a', 'b', 'a', 'c', 'b'])).toEqual(['a', 'b', 'c'])
  })

  it('leaves an already unique list untouched', () => {
    const items = Array.from({ length: 200 }, (_, i) => `item-${i}`)
    expect(uniqueByHash(items)).toEqual(items)
  })
})
