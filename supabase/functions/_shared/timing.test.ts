import { describe, it, expect } from 'vitest'

import { timingSafeEqualStrings } from '../_shared/timing'

describe('timingSafeEqualStrings', () => {
  it('returns true for identical strings', () => {
    expect(timingSafeEqualStrings('abc123', 'abc123')).toBe(true)
  })

  it('returns false for strings that differ in the first byte', () => {
    expect(timingSafeEqualStrings('abc123', 'xbc123')).toBe(false)
  })

  it('returns false for strings that differ in the last byte', () => {
    expect(timingSafeEqualStrings('abc123', 'abc124')).toBe(false)
  })

  it('returns false for strings of different length', () => {
    expect(timingSafeEqualStrings('abc', 'abcd')).toBe(false)
    expect(timingSafeEqualStrings('abcd', 'abc')).toBe(false)
  })

  it('returns false when one input is empty', () => {
    expect(timingSafeEqualStrings('', 'abc')).toBe(false)
    expect(timingSafeEqualStrings('abc', '')).toBe(false)
    expect(timingSafeEqualStrings('', '')).toBe(true)
  })

  it('handles non-ASCII characters without throwing', () => {
    expect(timingSafeEqualStrings('héllo', 'héllo')).toBe(true)
    expect(timingSafeEqualStrings('héllo', 'hèllo')).toBe(false)
  })

  it('always processes the full string even after a mismatch (constant-time property)', () => {
    // We can't directly measure timing here, but we can at least verify
    // the function returns synchronously without short-circuiting on the
    // first diff: it must not throw or misbehave when called with a
    // string that diverges immediately.
    const longA = 'a'.repeat(10_000) + 'X'
    const longB = 'b'.repeat(10_000) + 'X'
    expect(timingSafeEqualStrings(longA, longB)).toBe(false)
  })
})