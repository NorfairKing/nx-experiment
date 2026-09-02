import { fnv1a } from '@nx-exp/core'

const LCG_MULTIPLIER = 1664525
const LCG_INCREMENT = 1013904223

export interface Sequence {
  next(): number
  nextInt(bound: number): number
}

export function seeded(seed: string): Sequence {
  let state = fnv1a(seed)
  const step = (): number => {
    state = (Math.imul(state, LCG_MULTIPLIER) + LCG_INCREMENT) >>> 0
    return state
  }
  return {
    next: () => step() / 0x100000000,
    nextInt: (bound) => {
      if (bound <= 0) throw new RangeError(`bound must be positive, got ${bound}`)
      return step() % bound
    },
  }
}
