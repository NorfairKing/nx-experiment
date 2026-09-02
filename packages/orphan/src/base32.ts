const ALPHABET = 'abcdefghijklmnopqrstuvwxyz234567'

export function encodeBase32(bytes: readonly number[]): string {
  let bits = 0
  let value = 0
  let out = ''
  for (const byte of bytes) {
    value = (value << 8) | (byte & 0xff)
    bits += 8
    while (bits >= 5) {
      out += ALPHABET[(value >>> (bits - 5)) & 31]
      bits -= 5
    }
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31]
  return out
}

export function decodeBase32(text: string): number[] {
  let bits = 0
  let value = 0
  const out: number[] = []
  for (const char of text) {
    const index = ALPHABET.indexOf(char)
    if (index < 0) throw new SyntaxError(`not a base32 character: ${char}`)
    value = (value << 5) | index
    bits += 5
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff)
      bits -= 8
    }
  }
  return out
}
