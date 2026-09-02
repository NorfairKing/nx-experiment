import { describe, expect, it } from 'vitest'
import { fnv1a, hashHex, mixHashes } from '../src/hash.js'

describe('fnv1a', () => {
  it('matches the reference vector for the empty string', () => {
    expect(fnv1a('')).toBe(0x811c9dc5)
  })

  it('matches the reference vector for "a"', () => {
    expect(fnv1a('a')).toBe(0xe40c292c)
  })

  it('matches the reference vector for "foobar"', () => {
    expect(fnv1a('foobar')).toBe(0xbf9cf968)
  })

  it('stays inside the unsigned 32 bit range', () => {
    const values = Array.from({ length: 512 }, (_, i) => fnv1a(`input-${i}`))
    expect(values.every((v) => v >= 0 && v <= 0xffffffff)).toBe(true)
  })
})

describe('hashHex', () => {
  it('always renders eight hex digits', () => {
    const lengths = new Set(
      Array.from({ length: 256 }, (_, i) => hashHex(`k${i}`).length),
    )
    expect([...lengths]).toEqual([8])
  })
})

describe('mixHashes', () => {
  it('ignores argument order while both high halves are zero', () => {
    expect(mixHashes(1, 2)).toBe(mixHashes(2, 1))
  })

  it('depends on argument order once the high halves differ', () => {
    expect(mixHashes(0x12345678, 0x9abcdef0)).toBe(0x76eefc2c)
    expect(mixHashes(0x9abcdef0, 0x12345678)).toBe(0x76ee74a4)
  })
})
