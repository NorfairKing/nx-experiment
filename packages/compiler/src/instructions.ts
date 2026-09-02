export type Instruction =
  | { readonly op: 'push'; readonly value: number }
  | { readonly op: 'load'; readonly name: string }
  | { readonly op: 'apply'; readonly operator: string }

export function describeInstruction(instruction: Instruction): string {
  switch (instruction.op) {
    case 'push':
      return `push ${instruction.value}`
    case 'load':
      return `load ${instruction.name}`
    case 'apply':
      return `apply ${instruction.operator}`
  }
}
