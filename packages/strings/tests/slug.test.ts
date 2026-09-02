import { describe, expect, it } from 'vitest'
import { slugify, uniqueSlug } from '../src/slug.js'

describe('slugify', () => {
  it('collapses runs of punctuation into a single dash', () => {
    expect(slugify('Hello,   World!!')).toBe('hello-world')
  })

  it('is idempotent', () => {
    const once = slugify('A -- B -- C')
    expect(slugify(once)).toBe(once)
  })

  it('returns the empty string when nothing survives', () => {
    expect(slugify('!!!')).toBe('')
  })
})

describe('uniqueSlug', () => {
  it('appends a stable hash suffix', () => {
    expect(uniqueSlug('Hello World')).toBe(uniqueSlug('Hello World'))
    expect(uniqueSlug('Hello World')).toMatch(/^hello-world-[0-9a-f]{8}$/)
  })

  it('distinguishes inputs that share a slug', () => {
    expect(uniqueSlug('Hello World')).not.toBe(uniqueSlug('hello  world'))
  })

  it('falls back to the bare hash for slugless input', () => {
    expect(uniqueSlug('!!!')).toMatch(/^[0-9a-f]{8}$/)
  })
})
