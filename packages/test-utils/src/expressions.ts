import { seeded } from './random.js'

const OPERATORS = ['+', '-', '*', '/'] as const

export function randomExpression(seed: string, terms: number): string {
  const rng = seeded(seed)
  const parts: string[] = [String(rng.nextInt(90) + 1)]
  for (let i = 1; i < terms; i++) {
    parts.push(OPERATORS[rng.nextInt(OPERATORS.length)]!)
    parts.push(String(rng.nextInt(90) + 1))
  }
  return parts.join(' ')
}
