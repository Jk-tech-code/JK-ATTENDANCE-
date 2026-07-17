export class AlreadyCheckedInError extends Error {
  constructor() {
    super('You have already checked in today.')
    this.name = 'AlreadyCheckedInError'
  }
}

export class AlreadyCheckedOutError extends Error {
  constructor() {
    super('You have already checked out today.')
    this.name = 'AlreadyCheckedOutError'
  }
}

export class NoAttendanceRecordError extends Error {
  constructor() {
    super('No attendance record found. Please check in first.')
    this.name = 'NoAttendanceRecordError'
  }
}

export class UndoWindowExpiredError extends Error {
  constructor() {
    super('The undo window has expired (30 seconds).')
    this.name = 'UndoWindowExpiredError'
  }
}

export class GpsDeniedError extends Error {
  constructor() {
    super('Location access denied. Please enable GPS in your browser settings to check in.')
    this.name = 'GpsDeniedError'
  }
}

export class GpsUnavailableError extends Error {
  constructor() {
    super('GPS is unavailable. Please ensure location services are enabled on your device.')
    this.name = 'GpsUnavailableError'
  }
}

export class GpsTimeoutError extends Error {
  constructor() {
    super('GPS request timed out. Please try again in a location with better signal.')
    this.name = 'GpsTimeoutError'
  }
}

export class LocationRejectedError extends Error {
  distance: number
  radius: number

  constructor(distance: number, radius: number) {
    super('You are outside the approved school attendance zone.')
    this.name = 'LocationRejectedError'
    this.distance = distance
    this.radius = radius
  }
}

export class LowAccuracyError extends Error {
  accuracy: number
  threshold: number

  constructor(accuracy: number, threshold: number = 50) {
    super(`GPS signal too weak (${accuracy}m). Accuracy must be within ${threshold}m. Please move to an open area with better reception.`)
    this.name = 'LowAccuracyError'
    this.accuracy = accuracy
    this.threshold = threshold
  }
}
