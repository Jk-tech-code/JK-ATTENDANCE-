import {
  GpsDeniedError,
  GpsUnavailableError,
  GpsTimeoutError,
} from '@/lib/errors'

export interface GpsResult {
  latitude: number
  longitude: number
  accuracy: number
}

const GPS_OPTIONS: PositionOptions = {
  enableHighAccuracy: true,
  timeout: 15000,
  maximumAge: 0,
}

function getCurrentPosition(): Promise<GeolocationCoordinates> {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new GpsUnavailableError())
      return
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve(pos.coords),
      (err) => {
        switch (err.code) {
          case err.PERMISSION_DENIED:
            reject(new GpsDeniedError())
            break
          case err.POSITION_UNAVAILABLE:
            reject(new GpsUnavailableError())
            break
          case err.TIMEOUT:
            reject(new GpsTimeoutError())
            break
          default:
            reject(new GpsUnavailableError())
        }
      },
      GPS_OPTIONS
    )
  })
}

export function haversineDistance(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
  const R = 6371000
  const toRad = (deg: number) => (deg * Math.PI) / 180
  const dLat = toRad(lat2 - lat1)
  const dLon = toRad(lon2 - lon1)
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) *
      Math.cos(toRad(lat2)) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2)
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
  return R * c
}

export async function captureGpsPosition(): Promise<GpsResult> {
  const coords = await getCurrentPosition()
  return {
    latitude: coords.latitude,
    longitude: coords.longitude,
    accuracy: Math.round(coords.accuracy),
  }
}
