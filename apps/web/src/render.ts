import { evaluate, type Environment } from '@nx-exp/runtime'
import { truncate, uniqueSlug } from '@nx-exp/strings'

const ESCAPES: Readonly<Record<string, string>> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
}

export function escapeHtml(text: string): string {
  return text.replace(/[&<>"]/g, (char) => ESCAPES[char] ?? char)
}

export function renderExpression(
  source: string,
  environment: Environment = {},
): string {
  const id = uniqueSlug(source)
  const label = escapeHtml(truncate(source, 24))
  try {
    return `<li id="${id}"><code>${label}</code> = <output>${evaluate(source, environment)}</output></li>`
  } catch (error) {
    const message = escapeHtml(error instanceof Error ? error.message : 'unknown')
    return `<li id="${id}" class="failed"><code>${label}</code> <span>${message}</span></li>`
  }
}

export function renderList(
  sources: readonly string[],
  environment: Environment = {},
): string {
  const items = sources.map((source) => renderExpression(source, environment))
  return `<ul>${items.join('')}</ul>`
}
