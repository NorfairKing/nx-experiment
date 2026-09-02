import { describe, expect, it } from 'vitest'
import { err, flatMapResult, mapResult, ok, unwrapOr } from '../src/outcome.js'

describe('mapResult', () => {
  it('applies the function to an ok value', () => {
    expect(mapResult(ok(2), (n) => n * 3)).toEqual({ kind: 'ok', value: 6 })
  })

  it('leaves an err untouched', () => {
    expect(mapResult(err<string, number>('boom'), (n) => n * 3)).toEqual({
      kind: 'err',
      error: 'boom',
    })
  })
})

describe('flatMapResult', () => {
  it('chains through ok values', () => {
    const halve = (n: number) =>
      n % 2 === 0 ? ok<number, string>(n / 2) : err<string, number>('odd')
    expect(flatMapResult(ok<number, string>(8), halve)).toEqual({
      kind: 'ok',
      value: 4,
    })
    expect(flatMapResult(ok<number, string>(7), halve)).toEqual({
      kind: 'err',
      error: 'odd',
    })
  })
})

describe('unwrapOr', () => {
  it('returns the fallback for an err', () => {
    expect(unwrapOr(err<string, number>('nope'), 42)).toBe(42)
  })
})
