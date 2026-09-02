import { MultiMap } from '@nx-exp/collections'
import type { Node } from './nodes.js'

export function children(node: Node): readonly Node[] {
  return node.kind === 'binary' ? [node.left, node.right] : []
}

export function depth(node: Node): number {
  return node.kind === 'binary'
    ? 1 + Math.max(depth(node.left), depth(node.right))
    : 1
}

export function collectByKind(root: Node): MultiMap<Node['kind'], Node> {
  const found = new MultiMap<Node['kind'], Node>()
  const pending: Node[] = [root]
  while (pending.length > 0) {
    const node = pending.pop()!
    found.add(node.kind, node)
    for (const child of children(node)) pending.push(child)
  }
  return found
}

export function render(node: Node): string {
  switch (node.kind) {
    case 'number':
      return String(node.value)
    case 'identifier':
      return node.name
    case 'binary':
      return `(${render(node.left)} ${node.op} ${render(node.right)})`
  }
}
