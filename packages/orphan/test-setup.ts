import { expect } from 'vitest'

// Registers a matcher the tests rely on. If this file is not loaded, the
// matcher is missing and the tests that use it fail.
expect.extend({
  toRoundTripThrough(received: readonly number[], codec: {
    encode: (bytes: readonly number[]) => string
    decode: (text: string) => number[]
  }) {
    const actual = codec.decode(codec.encode(received))
    const pass =
      actual.length === received.length &&
      actual.every((byte, i) => byte === received[i])
    return {
      pass,
      message: () =>
        pass
          ? `expected not to round-trip, but it did`
          : `expected round-trip to preserve [${received}], got [${actual}]`,
    }
  },
})
