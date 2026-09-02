import { describe, expect, it } from 'vitest'
import { decodeBase32, encodeBase32 } from '../src/base32.js'

describe('encodeBase32', () => {
  it('encodes the empty input as the empty string', () => {
    expect(encodeBase32([])).toBe('')
  })

  it('uses five bits per output character', () => {
    expect(encodeBase32([0x00]).length).toBe(2)
    expect(encodeBase32([0xff, 0xff]).length).toBe(4)
  })
})

describe('decodeBase32', () => {
  it('round-trips whole byte groups', () => {
    const bytes = Array.from({ length: 40 }, (_, i) => (i * 7 + 3) & 0xff)
    expect(decodeBase32(encodeBase32(bytes))).toEqual(bytes)
  })

  it('rejects characters outside the alphabet', () => {
    expect(() => decodeBase32('abc1')).toThrow(SyntaxError)
  })
})
