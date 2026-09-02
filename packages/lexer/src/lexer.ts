import { makeToken, type Token } from '@nx-exp/tokens'
import { slugify } from '@nx-exp/strings'

const OPERATORS = '+-*/'

export function tokenize(source: string): Token[] {
  const tokens: Token[] = []
  let i = 0
  while (i < source.length) {
    const char = source[i]!
    if (char === ' ' || char === '\t' || char === '\n') {
      i++
      continue
    }
    if (char >= '0' && char <= '9') {
      let end = i
      while (end < source.length && source[end]! >= '0' && source[end]! <= '9') {
        end++
      }
      tokens.push(makeToken('number', source.slice(i, end), i))
      i = end
      continue
    }
    if (/[A-Za-z_]/.test(char)) {
      let end = i
      while (end < source.length && /[A-Za-z0-9_]/.test(source[end]!)) end++
      tokens.push(makeToken('identifier', normalizeName(source.slice(i, end)), i))
      i = end
      continue
    }
    if (OPERATORS.includes(char)) {
      tokens.push(makeToken('operator', char, i))
      i++
      continue
    }
    if (char === '(') {
      tokens.push(makeToken('lparen', char, i))
      i++
      continue
    }
    if (char === ')') {
      tokens.push(makeToken('rparen', char, i))
      i++
      continue
    }
    throw new SyntaxError(`unexpected character ${JSON.stringify(char)} at ${i}`)
  }
  return tokens
}

export function normalizeName(raw: string): string {
  const slug = slugify(raw)
  return slug === '' ? raw.toLowerCase() : slug.replace(/-/g, '_')
}
