import { describe, expect, it } from 'vitest'
import { describeToken, makeToken, sameToken } from '../src/token.js'

describe('makeToken', () => {
  it('gives the same id to tokens with the same kind and text', () => {
    expect(makeToken('number', '42', 0).id).toBe(makeToken('number', '42', 9).id)
  })

  it('gives different ids to the same text under different kinds', () => {
    expect(makeToken('number', 'x', 0).id).not.toBe(
      makeToken('identifier', 'x', 0).id,
    )
  })

  it('keeps the offset it was given', () => {
    expect(makeToken('operator', '+', 7).offset).toBe(7)
  })
})

describe('sameToken', () => {
  it('ignores the offset', () => {
    expect(sameToken(makeToken('lparen', '(', 0), makeToken('lparen', '(', 5))).toBe(
      true,
    )
  })

  it('distinguishes different kinds', () => {
    expect(
      sameToken(makeToken('number', '1', 0), makeToken('identifier', '1', 0)),
    ).toBe(false)
  })
})

describe('describeToken', () => {
  it('renders kind, text and offset', () => {
    expect(describeToken(makeToken('operator', '*', 3))).toBe('operator(*)@3')
  })
})
