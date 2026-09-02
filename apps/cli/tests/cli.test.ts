import { describe, expect, it } from 'vitest'
import { parseAssignments, run } from '../src/cli.js'

describe('parseAssignments', () => {
  it('collects name=value pairs', () => {
    expect(parseAssignments(['x=1', 'y=2.5', '1 + 1'])).toEqual({
      x: 1,
      y: 2.5,
    })
  })

  it('rejects a non-numeric assignment', () => {
    expect(() => parseAssignments(['x=abc'])).toThrow(SyntaxError)
  })
})

describe('run', () => {
  it('prints usage when given no expression', () => {
    expect(run(['x=1'])).toEqual({
      output: ['usage: cli <expression> [name=value ...]'],
      exitCode: 2,
    })
  })

  it('evaluates each expression against the assignments', () => {
    expect(run(['1 + 2 * 3', 'x * 2', 'x=5'])).toEqual({
      output: ['1 + 2 * 3 = 7', 'x * 2 = 10'],
      exitCode: 0,
    })
  })

  it('reports a failing expression through the log and exit code', () => {
    const result = run(['1 +'])
    expect(result.exitCode).toBe(1)
    expect(result.output.length).toBe(1)
    expect(result.output[0]).toMatch(/^\[[0-9a-f]{8}\] ERROR: /)
  })
})
