import { fnv1a } from '@nx-exp/core'

export function chunk<T>(items: readonly T[], size: number): T[][] {
  if (size <= 0) throw new RangeError(`chunk size must be positive, got ${size}`)
  const out: T[][] = []
  for (let i = 0; i < items.length; i += size) {
    out.push(items.slice(i, i + size))
  }
  return out
}

export function uniqueByHash(items: readonly string[]): string[] {
  const seen = new Set<number>()
  const out: string[] = []
  for (const item of items) {
    const key = fnv1a(item)
    if (!seen.has(key)) {
      seen.add(key)
      out.push(item)
    }
  }
  return out
}
