import { hashHex } from '@nx-exp/core'

export const LEVELS = ['debug', 'info', 'warn', 'error'] as const

export type Level = (typeof LEVELS)[number]

export interface Entry {
  readonly level: Level
  readonly message: string
  readonly correlationId: string
}

export interface Logger {
  log(level: Level, message: string): void
  entries(): readonly Entry[]
}

export function levelRank(level: Level): number {
  return LEVELS.indexOf(level)
}

export function createLogger(scope: string, minLevel: Level = 'info'): Logger {
  const collected: Entry[] = []
  const correlationId = hashHex(scope)
  return {
    log(level, message) {
      if (levelRank(level) < levelRank(minLevel)) return
      collected.push({ level, message, correlationId })
    },
    entries() {
      return collected
    },
  }
}

export function formatEntry(entry: Entry): string {
  return `[${entry.correlationId}] ${entry.level.toUpperCase()}: ${entry.message}`
}
