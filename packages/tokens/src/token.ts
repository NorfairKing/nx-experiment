import { fnv1a, mixHashes } from '@nx-exp/core'

export const TOKEN_KINDS = [
  'number',
  'identifier',
  'operator',
  'lparen',
  'rparen',
] as const

export type TokenKind = (typeof TOKEN_KINDS)[number]

export interface Token {
  readonly kind: TokenKind
  readonly text: string
  readonly offset: number
  readonly id: number
}

export function makeToken(
  kind: TokenKind,
  text: string,
  offset: number,
): Token {
  return { kind, text, offset, id: mixHashes(fnv1a(kind), fnv1a(text)) }
}

export function sameToken(left: Token, right: Token): boolean {
  return left.kind === right.kind && left.text === right.text
}

export function describeToken(token: Token): string {
  return `${token.kind}(${token.text})@${token.offset}`
}
