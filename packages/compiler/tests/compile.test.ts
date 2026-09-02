import { describe, expect, it } from 'vitest'
import { formatEntry } from '@nx-exp/logging'
import { compile, emit } from '../src/compile.js'
import { describeInstruction } from '../src/instructions.js'

describe('emit', () => {
  it('emits a single push for a literal', () => {
    expect(emit({ kind: 'number', value: 7 })).toEqual([
      { op: 'push', value: 7 },
    ])
  })

  it('emits operands before the operator', () => {
    expect(
      emit({
        kind: 'binary',
        op: '+',
        left: { kind: 'number', value: 1 },
        right: { kind: 'identifier', name: 'x' },
      }),
    ).toEqual([
      { op: 'push', value: 1 },
      { op: 'load', name: 'x' },
      { op: 'apply', operator: '+' },
    ])
  })
})

describe('compile', () => {
  it('follows precedence through to the instruction order', () => {
    expect(compile('1 + 2 * 3').instructions.map(describeInstruction)).toEqual([
      'push 1',
      'push 2',
      'push 3',
      'apply *',
      'apply +',
    ])
  })

  it('logs the parse and emit stages', () => {
    const { logger } = compile('1 + 1')
    expect(logger.entries().map((e) => e.message)).toEqual([
      'parsed a binary at the root',
      'emitted 3 instructions',
    ])
  })

  it('includes the debug stage when the level allows it', () => {
    const { logger } = compile('1', 'debug')
    expect(logger.entries().map(formatEntry).length).toBe(3)
  })

  it('propagates a parse error', () => {
    expect(() => compile('1 +')).toThrow(SyntaxError)
  })
})
