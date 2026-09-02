import { mergeConfig, defineConfig } from 'vitest/config'
import shared from '../../vitest.shared'

export default mergeConfig(
  shared,
  defineConfig({
    test: {
      name: 'orphan',
      // Deliberately outside tests/, which is where a real repo often puts it.
      setupFiles: ['./test-setup.ts'],
    },
  }),
)
