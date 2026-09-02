import { step } from '@nx-exp/chain-d'

export function twice(n: number): number {
  return step(step(n))
}
