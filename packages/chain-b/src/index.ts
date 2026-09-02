import { twice } from '@nx-exp/chain-c'

export function sumTwice(upTo: number): number {
  let total = 0
  for (let i = 0; i < upTo; i++) total += twice(i)
  return total
}
