import { describe, expect, it } from 'vitest'
import { render } from '@nx-exp/ast'
import { randomExpression } from '@nx-exp/test-utils'
import { parse } from '../src/parser.js'

describe('parse then render', () => {
  it('reparses its own rendering to the same tree', () => {
    for (let i = 0; i < 120; i++) {
      const source = randomExpression(`roundtrip-${i}`, 12)
      const once = render(parse(source))
      expect(render(parse(once))).toBe(once)
    }
  })
})
