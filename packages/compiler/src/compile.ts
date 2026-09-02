import { parse } from '@nx-exp/parser'
import { createLogger, type Level, type Logger } from '@nx-exp/logging'
import type { Node } from '@nx-exp/ast'
import type { Instruction } from './instructions.js'

export interface Compilation {
  readonly instructions: readonly Instruction[]
  readonly logger: Logger
}

export function emit(node: Node): Instruction[] {
  switch (node.kind) {
    case 'number':
      return [{ op: 'push', value: node.value }]
    case 'identifier':
      return [{ op: 'load', name: node.name }]
    case 'binary':
      return [
        ...emit(node.left),
        ...emit(node.right),
        { op: 'apply', operator: node.op },
      ]
  }
}

export function compile(source: string, minLevel: Level = 'info'): Compilation {
  const logger = createLogger('compiler', minLevel)
  logger.log('debug', `compiling ${source.length} characters`)
  const tree = parse(source)
  logger.log('info', `parsed a ${tree.kind} at the root`)
  const instructions = emit(tree)
  logger.log('info', `emitted ${instructions.length} instructions`)
  return { instructions, logger }
}
