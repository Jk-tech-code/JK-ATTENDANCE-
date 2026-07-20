import { describe, it, expect } from 'vitest'
import {
  AlreadyCheckedInError,
  AlreadyCheckedOutError,
  NoAttendanceRecordError,
  UndoWindowExpiredError,
  GpsDeniedError,
  GpsUnavailableError,
  GpsTimeoutError,
  LocationRejectedError,
  LowAccuracyError,
} from './errors'

describe('AlreadyCheckedInError', () => {
  it('has correct name and message', () => {
    const err = new AlreadyCheckedInError()
    expect(err.name).toBe('AlreadyCheckedInError')
    expect(err.message).toContain('already checked in')
  })
})

describe('AlreadyCheckedOutError', () => {
  it('has correct name and message', () => {
    const err = new AlreadyCheckedOutError()
    expect(err.name).toBe('AlreadyCheckedOutError')
    expect(err.message).toContain('already checked out')
  })
})

describe('NoAttendanceRecordError', () => {
  it('has correct name and message', () => {
    const err = new NoAttendanceRecordError()
    expect(err.name).toBe('NoAttendanceRecordError')
    expect(err.message).toContain('check in first')
  })
})

describe('UndoWindowExpiredError', () => {
  it('has correct name and message', () => {
    const err = new UndoWindowExpiredError()
    expect(err.name).toBe('UndoWindowExpiredError')
    expect(err.message).toContain('5 minutes')
  })
})

describe('GpsDeniedError', () => {
  it('has correct name and message', () => {
    const err = new GpsDeniedError()
    expect(err.name).toBe('GpsDeniedError')
    expect(err.message).toContain('Location access denied')
  })
})

describe('GpsUnavailableError', () => {
  it('has correct name and message', () => {
    const err = new GpsUnavailableError()
    expect(err.name).toBe('GpsUnavailableError')
    expect(err.message).toContain('GPS is unavailable')
  })
})

describe('GpsTimeoutError', () => {
  it('has correct name and message', () => {
    const err = new GpsTimeoutError()
    expect(err.name).toBe('GpsTimeoutError')
    expect(err.message).toContain('timed out')
  })
})

describe('LocationRejectedError', () => {
  it('stores distance and radius', () => {
    const err = new LocationRejectedError(250, 100)
    expect(err.name).toBe('LocationRejectedError')
    expect(err.distance).toBe(250)
    expect(err.radius).toBe(100)
    expect(err.message).toContain('outside')
  })
})

describe('LowAccuracyError', () => {
  it('uses default threshold of 50', () => {
    const err = new LowAccuracyError(120)
    expect(err.name).toBe('LowAccuracyError')
    expect(err.accuracy).toBe(120)
    expect(err.threshold).toBe(50)
    expect(err.message).toContain('120m')
  })

  it('accepts custom threshold', () => {
    const err = new LowAccuracyError(80, 30)
    expect(err.threshold).toBe(30)
  })
})
