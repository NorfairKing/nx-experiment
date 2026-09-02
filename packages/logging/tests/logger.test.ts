import { describe, expect, it } from 'vitest'
import { createLogger, formatEntry, levelRank } from '../src/logger.js'

describe('levelRank', () => {
  it('orders levels by increasing severity', () => {
    expect([
      levelRank('debug'),
      levelRank('info'),
      levelRank('warn'),
      levelRank('error'),
    ]).toEqual([0, 1, 2, 3])
  })
})

describe('createLogger', () => {
  it('drops entries below the minimum level', () => {
    const logger = createLogger('scope', 'warn')
    logger.log('debug', 'dropped')
    logger.log('info', 'dropped')
    logger.log('warn', 'kept')
    logger.log('error', 'kept')
    expect(logger.entries().map((e) => e.message)).toEqual(['kept', 'kept'])
  })

  it('stamps every entry with the same correlation id', () => {
    const logger = createLogger('billing')
    logger.log('info', 'one')
    logger.log('error', 'two')
    const ids = new Set(logger.entries().map((e) => e.correlationId))
    expect(ids.size).toBe(1)
  })

  it('derives the correlation id from the scope', () => {
    const a = createLogger('alpha')
    const b = createLogger('beta')
    a.log('info', 'x')
    b.log('info', 'x')
    expect(a.entries()[0]?.correlationId).not.toBe(b.entries()[0]?.correlationId)
  })
})

describe('formatEntry', () => {
  it('renders the correlation id, level and message', () => {
    const logger = createLogger('scope')
    logger.log('warn', 'disk almost full')
    const entry = logger.entries()[0]
    expect(entry).toBeDefined()
    expect(formatEntry(entry!)).toMatch(
      /^\[[0-9a-f]{8}\] WARN: disk almost full$/,
    )
  })
})
