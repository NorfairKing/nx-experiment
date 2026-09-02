import { describe, expect, it } from 'vitest'
import { binaryNode, identifierNode, numberNode } from '../src/nodes.js'
import { children, collectByKind, depth, render } from '../src/walk.js'

const tree = binaryNode(
  '*',
  binaryNode('+', numberNode(1), numberNode(2)),
  identifierNode('x'),
)

describe('children', () => {
  it('returns both operands of a binary node', () => {
    expect(children(tree).length).toBe(2)
  })

  it('returns nothing for a leaf', () => {
    expect(children(numberNode(1))).toEqual([])
  })
})

describe('depth', () => {
  it('counts a leaf as depth one', () => {
    expect(depth(numberNode(1))).toBe(1)
  })

  it('takes the deeper branch', () => {
    expect(depth(tree)).toBe(3)
  })
})

describe('collectByKind', () => {
  it('groups every node by its kind', () => {
    const found = collectByKind(tree)
    expect(found.get('number').length).toBe(2)
    expect(found.get('identifier').length).toBe(1)
    expect(found.get('binary').length).toBe(2)
    expect(found.totalValues()).toBe(5)
  })
})

describe('render', () => {
  it('parenthesises every binary node', () => {
    expect(render(tree)).toBe('((1 + 2) * x)')
  })
})
