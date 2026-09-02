import { sumTwice } from '@nx-exp/chain-b'

export function report(upTo: number): string {
  return `sum(${upTo}) = ${sumTwice(upTo)}`
}
