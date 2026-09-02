import { evaluate, type Environment } from '@nx-exp/runtime'
import { createLogger, formatEntry } from '@nx-exp/logging'

export interface Invocation {
  readonly output: readonly string[]
  readonly exitCode: number
}

export function parseAssignments(args: readonly string[]): Environment {
  const environment: Record<string, number> = {}
  for (const arg of args) {
    const separator = arg.indexOf('=')
    if (separator < 0) continue
    const name = arg.slice(0, separator)
    const value = Number(arg.slice(separator + 1))
    if (Number.isNaN(value)) throw new SyntaxError(`not a number in ${arg}`)
    environment[name] = value
  }
  return environment
}

export function run(args: readonly string[]): Invocation {
  const logger = createLogger('cli')
  const expressions = args.filter((arg) => !arg.includes('='))
  if (expressions.length === 0) {
    return { output: ['usage: cli <expression> [name=value ...]'], exitCode: 2 }
  }
  const environment = parseAssignments(args)
  const output: string[] = []
  let exitCode = 0
  for (const expression of expressions) {
    try {
      output.push(`${expression} = ${evaluate(expression, environment)}`)
    } catch (error) {
      logger.log('error', error instanceof Error ? error.message : 'unknown')
      exitCode = 1
    }
  }
  return { output: [...output, ...logger.entries().map(formatEntry)], exitCode }
}
