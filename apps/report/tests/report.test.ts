import { describe, expect, it } from 'vitest'
import { distinctInstructions, histogram, summarize } from '../src/report.js'

describe('histogram', () => {
  it('counts each instruction kind', () => {
    expect([...histogram('1 + 2 * 3').entries()].sort()).toEqual([
      ['apply', 2],
      ['push', 3],
    ])
  })

  it('counts a load for each identifier occurrence', () => {
    expect(histogram('x + x').get('load')).toBe(2)
  })
})

describe('distinctInstructions', () => {
  it('collapses repeated instructions', () => {
    expect(distinctInstructions('x + x')).toEqual(['load x', 'apply +'])
  })

  it('keeps distinct pushes apart', () => {
    expect(distinctInstructions('1 + 2')).toEqual(['push 1', 'push 2', 'apply +'])
  })
})

describe('summarize', () => {
  it('renders one line per source', () => {
    expect(summarize(['1 + 1', 'x * 2'])).toBe(
      '1 + 1: apply=1 push=2\nx * 2: apply=1 load=1 push=1',
    )
  })

  it('renders nothing for no sources', () => {
    expect(summarize([])).toBe('')
  })
})
