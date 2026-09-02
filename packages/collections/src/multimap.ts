export class MultiMap<K, V> {
  private readonly buckets = new Map<K, V[]>()

  add(key: K, value: V): this {
    const bucket = this.buckets.get(key)
    if (bucket === undefined) {
      this.buckets.set(key, [value])
    } else {
      bucket.push(value)
    }
    return this
  }

  get(key: K): readonly V[] {
    return this.buckets.get(key) ?? []
  }

  keys(): readonly K[] {
    return [...this.buckets.keys()]
  }

  get size(): number {
    return this.buckets.size
  }

  totalValues(): number {
    let total = 0
    for (const bucket of this.buckets.values()) total += bucket.length
    return total
  }
}
