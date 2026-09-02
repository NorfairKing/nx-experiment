import { describe, expect, it } from 'vitest'
import { MultiMap } from '../src/multimap.js'

describe('MultiMap', () => {
  it('groups values under a shared key in insertion order', () => {
    const m = new MultiMap<string, number>()
    m.add('a', 1).add('b', 2).add('a', 3)
    expect(m.get('a')).toEqual([1, 3])
    expect(m.get('b')).toEqual([2])
  })

  it('reports an empty bucket for an unknown key', () => {
    expect(new MultiMap<string, number>().get('missing')).toEqual([])
  })

  it('counts keys and values separately', () => {
    const m = new MultiMap<number, number>()
    for (let i = 0; i < 30; i++) m.add(i % 5, i)
    expect(m.size).toBe(5)
    expect(m.totalValues()).toBe(30)
  })
})
