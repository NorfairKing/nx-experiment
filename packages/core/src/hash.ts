const FNV_OFFSET_BASIS = 0x811c9dc5
const FNV_PRIME = 0x01000193

export function fnv1a(input: string): number {
  let hash = FNV_OFFSET_BASIS
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i)
    hash = Math.imul(hash, FNV_PRIME) >>> 0
  }
  return hash >>> 0
}

export function hashHex(input: string): string {
  return fnv1a(input).toString(16).padStart(8, '0')
}

export function mixHashes(left: number, right: number): number {
  return (Math.imul(left ^ right, FNV_PRIME) >>> 0) ^ (left >>> 16)
}

const unused = 1
void unused
