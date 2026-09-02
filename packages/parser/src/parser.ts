import { tokenize } from '@nx-exp/lexer'
import { binaryNode, leafFromToken, type Node } from '@nx-exp/ast'
import type { Token } from '@nx-exp/tokens'

const PRECEDENCE: Record<string, number> = { '+': 1, '-': 1, '*': 2, '/': 2 }

export function parse(source: string): Node {
  const tokens = tokenize(source)
  let position = 0

  const peek = (): Token | undefined => tokens[position]

  const parsePrimary = (): Node => {
    const token = peek()
    if (token === undefined) throw new SyntaxError('unexpected end of input')
    position++
    if (token.kind === 'number' || token.kind === 'identifier') {
      return leafFromToken(token)
    }
    if (token.kind === 'lparen') {
      const inner = parseBinary(0)
      const closing = peek()
      if (closing?.kind !== 'rparen') {
        throw new SyntaxError(`expected ) at offset ${closing?.offset ?? source.length}`)
      }
      position++
      return inner
    }
    throw new SyntaxError(`unexpected ${token.kind} at offset ${token.offset}`)
  }

  const parseBinary = (minPrecedence: number): Node => {
    let left = parsePrimary()
    for (;;) {
      const token = peek()
      if (token === undefined || token.kind !== 'operator') break
      const precedence = PRECEDENCE[token.text]
      if (precedence === undefined || precedence < minPrecedence) break
      position++
      left = binaryNode(token.text, left, parseBinary(precedence + 1))
    }
    return left
  }

  const result = parseBinary(0)
  const trailing = peek()
  if (trailing !== undefined) {
    throw new SyntaxError(`unexpected trailing ${trailing.kind} at offset ${trailing.offset}`)
  }
  return result
}
