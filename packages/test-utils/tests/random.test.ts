import { describe, expect, it } from 'vitest'
import { seeded } from '../src/random.js'

describe('seeded', () => {
  it('produces the same sequence for the same seed', () => {
    const a = Array.from({ length: 10 }, () => seeded('same').nextInt(1000))
    expect(new Set(a).size).toBe(1)
  })

  it('produces different sequences for different seeds', () => {
    const a = seeded('alpha')
    const b = seeded('beta')
    const left = Array.from({ length: 8 }, () => a.nextInt(1000))
    const right = Array.from({ length: 8 }, () => b.nextInt(1000))
    expect(left).not.toEqual(right)
  })

  it('keeps next() inside the unit interval', () => {
    const rng = seeded('unit')
    const values = Array.from({ length: 500 }, () => rng.next())
    expect(values.every((v) => v >= 0 && v < 1)).toBe(true)
  })

  it('rejects a non-positive bound', () => {
    expect(() => seeded('x').nextInt(0)).toThrow(RangeError)
  })
})
