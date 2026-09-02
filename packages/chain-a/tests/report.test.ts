import { describe, expect, it } from 'vitest'
import { report } from '../src/index.js'

describe('report', () => {
  it('renders the range and its total', () => {
    expect(report(3)).toBe('sum(3) = 21')
  })

  it('reports zero for an empty range', () => {
    expect(report(0)).toBe('sum(0) = 0')
  })
})
