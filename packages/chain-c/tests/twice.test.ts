import { describe, expect, it } from 'vitest'
import { twice } from '../src/index.js'

describe('twice', () => {
  it('applies the step twice', () => {
    expect(twice(0)).toBe(3)
    expect(twice(1)).toBe(7)
  })

  it('grows by a factor of four plus three', () => {
    expect(Array.from({ length: 20 }, (_, i) => twice(i))).toEqual(
      Array.from({ length: 20 }, (_, i) => 4 * i + 3),
    )
  })
})
