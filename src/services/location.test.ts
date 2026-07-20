import { describe, it, expect } from 'vitest'
import { haversineDistance, isWithinRadius } from './location'

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

  // ─── Geofence boundary tests with new school coordinates ───
  const SCHOOL_LAT = -1.472988
  const SCHOOL_LNG = 36.960895
  const RADIUS = 100 // meters

  it('returns 0m at exact school location (inside geofence)', () => {
    const dist = haversineDistance(SCHOOL_LAT, SCHOOL_LNG, SCHOOL_LAT, SCHOOL_LNG)
    expect(dist).toBe(0)
    expect(isWithinRadius(dist, RADIUS)).toBe(true)
  })

  it('returns < 100m for a point ~50m from school (inside geofence)', () => {
    // ~50m south of school
    const dist = haversineDistance(SCHOOL_LAT, SCHOOL_LNG, -1.473438, 36.960895)
    expect(dist).toBeGreaterThan(40)
    expect(dist).toBeLessThan(60)
    expect(isWithinRadius(dist, RADIUS)).toBe(true)
  })

  it('returns ~274m for a point ~275m from school (outside geofence)', () => {
    // ~275m northwest of school
    const dist = haversineDistance(SCHOOL_LAT, SCHOOL_LNG, -1.471200, 36.959200)
    expect(dist).toBeGreaterThan(260)
    expect(dist).toBeLessThan(290)
    expect(isWithinRadius(dist, RADIUS)).toBe(false)
  })

  it('returns > 100m for a point ~500m from school (outside geofence)', () => {
    // ~500m northeast of school
    const dist = haversineDistance(SCHOOL_LAT, SCHOOL_LNG, -1.469500, 36.965000)
    expect(dist).toBeGreaterThan(450)
    expect(dist).toBeLessThan(600)
    expect(isWithinRadius(dist, RADIUS)).toBe(false)
  })

  it('rejects a point 1km away (far outside geofence)', () => {
    // ~1km away
    const dist = haversineDistance(SCHOOL_LAT, SCHOOL_LNG, -1.463000, 36.962000)
    expect(dist).toBeGreaterThan(1000)
    expect(isWithinRadius(dist, RADIUS)).toBe(false)
  })
})
