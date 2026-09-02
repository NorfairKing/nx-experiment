import { hashHex } from '@nx-exp/core/hashing'

const NON_SLUG = /[^a-z0-9]+/g

export function slugify(input: string): string {
  return input.toLowerCase().replace(NON_SLUG, '-').replace(/^-|-$/g, '')
}

export function uniqueSlug(input: string): string {
  const base = slugify(input)
  return base === '' ? hashHex(input) : `${base}-${hashHex(input)}`
}
