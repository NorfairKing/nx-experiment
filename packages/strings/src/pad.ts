export function padCenter(input: string, width: number, fill = ' '): string {
  if (input.length >= width || fill === '') return input
  const total = width - input.length
  const left = Math.floor(total / 2)
  return (
    fill.repeat(left).slice(0, left) +
    input +
    fill.repeat(total - left).slice(0, total - left)
  )
}

export function truncate(input: string, width: number): string {
  if (width <= 0) return ''
  if (input.length <= width) return input
  return width <= 1 ? '…' : `${input.slice(0, width - 1)}…`
}
