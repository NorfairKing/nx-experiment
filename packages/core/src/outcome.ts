export type Result<T, E> =
  | { readonly kind: 'ok'; readonly value: T }
  | { readonly kind: 'err'; readonly error: E }

export function ok<T, E = never>(value: T): Result<T, E> {
  return { kind: 'ok', value }
}

export function err<E, T = never>(error: E): Result<T, E> {
  return { kind: 'err', error }
}

export function mapResult<T, U, E>(
  result: Result<T, E>,
  f: (value: T) => U,
): Result<U, E> {
  return result.kind === 'ok' ? ok(f(result.value)) : err(result.error)
}

export function flatMapResult<T, U, E>(
  result: Result<T, E>,
  f: (value: T) => Result<U, E>,
): Result<U, E> {
  return result.kind === 'ok' ? f(result.value) : err(result.error)
}

export function unwrapOr<T, E>(result: Result<T, E>, fallback: T): T {
  return result.kind === 'ok' ? result.value : fallback
}
