import { describeToken, type Token } from '@nx-exp/tokens'

export type Node =
  | { readonly kind: 'number'; readonly value: number }
  | { readonly kind: 'identifier'; readonly name: string }
  | {
      readonly kind: 'binary'
      readonly op: string
      readonly left: Node
      readonly right: Node
    }

export function numberNode(value: number): Node {
  return { kind: 'number', value }
}

export function identifierNode(name: string): Node {
  return { kind: 'identifier', name }
}

export function binaryNode(op: string, left: Node, right: Node): Node {
  return { kind: 'binary', op, left, right }
}

export function leafFromToken(token: Token): Node {
  switch (token.kind) {
    case 'number':
      return numberNode(Number(token.text))
    case 'identifier':
      return identifierNode(token.text)
    case 'operator':
    case 'lparen':
    case 'rparen':
      throw new SyntaxError(`${describeToken(token)} is not a leaf`)
  }
}
