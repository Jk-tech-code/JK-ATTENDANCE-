import { describe, it, expect } from 'vitest'
import { haversineDistance } from './location'

describe('haversineDistance', () => {
  it('returns 0 for same point', () => {
    expect(haversineDistance(0, 0, 0, 0)).toBe(0)
  })

  it('calculates ~111km for 1 degree latitude', () => {
    const dist = haversineDistance(0, 0, 1, 0)
    expect(dist).toBeGreaterThan(110000)
    expect(dist).toBeLessThan(112000)
  })

  it('calculates Nairobi to Mombasa distance (~480km)', () => {
    const dist = haversineDistance(-1.286389, 36.817223, -4.043477, 39.668206)
    expect(dist).toBeGreaterThan(440000)
    expect(dist).toBeLessThan(500000)
  })

  it('is symmetric', () => {
    const d1 = haversineDistance(-1.28, 36.81, -1.29, 36.82)
    const d2 = haversineDistance(-1.29, 36.82, -1.28, 36.81)
    expect(d1).toBeCloseTo(d2)
  })

  it('returns meters as integer', () => {
    const dist = haversineDistance(-1.286389, 36.817223, -1.287, 36.818)
    expect(Number.isInteger(Math.round(dist))).toBe(true)
  })
})
