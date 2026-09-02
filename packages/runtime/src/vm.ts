import { compile, type Instruction } from '@nx-exp/compiler'

export type Environment = Readonly<Record<string, number>>

export function apply(operator: string, left: number, right: number): number {
  switch (operator) {
    case '+':
      return left + right
    case '-':
      return left - right
    case '*':
      return left * right
    case '/':
      if (right === 0) throw new RangeError('division by zero')
      return left / right
    default:
      throw new SyntaxError(`unknown operator ${operator}`)
  }
}

export function execute(
  instructions: readonly Instruction[],
  environment: Environment = {},
): number {
  const stack: number[] = []
  for (const instruction of instructions) {
    switch (instruction.op) {
      case 'push':
        stack.push(instruction.value)
        break
      case 'load': {
        const value = environment[instruction.name]
        if (value === undefined) {
          throw new ReferenceError(`unbound name ${instruction.name}`)
        }
        stack.push(value)
        break
      }
      case 'apply': {
        const right = stack.pop()
        const left = stack.pop()
        if (left === undefined || right === undefined) {
          throw new RangeError('stack underflow')
        }
        stack.push(apply(instruction.operator, left, right))
        break
      }
    }
  }
  const result = stack.pop()
  if (result === undefined || stack.length > 0) {
    throw new RangeError(`unbalanced stack, ${stack.length + 1} values left`)
  }
  return result
}

export function evaluate(source: string, environment: Environment = {}): number {
  return execute(compile(source).instructions, environment)
}
