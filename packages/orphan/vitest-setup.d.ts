import 'vitest'

declare module 'vitest' {
  interface Matchers<T = unknown> {
    toRoundTripThrough(codec: {
      encode: (bytes: readonly number[]) => string
      decode: (text: string) => number[]
    }): T
  }
}
