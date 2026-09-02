import { compile, describeInstruction, type Instruction } from '@nx-exp/compiler'
import { MultiMap, uniqueByHash } from '@nx-exp/collections'

export function histogram(source: string): Map<Instruction['op'], number> {
  const grouped = new MultiMap<Instruction['op'], Instruction>()
  for (const instruction of compile(source).instructions) {
    grouped.add(instruction.op, instruction)
  }
  const counts = new Map<Instruction['op'], number>()
  for (const op of grouped.keys()) counts.set(op, grouped.get(op).length)
  return counts
}

export function distinctInstructions(source: string): string[] {
  return uniqueByHash(compile(source).instructions.map(describeInstruction))
}

export function summarize(sources: readonly string[]): string {
  const lines = sources.map((source) => {
    const counts = [...histogram(source).entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([op, count]) => `${op}=${count}`)
      .join(' ')
    return `${source}: ${counts}`
  })
  return lines.join('\n')
}
