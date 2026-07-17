export type DeviceType = 'Desktop' | 'Laptop' | 'Tablet' | 'Mobile'
export type BrowserName = 'Chrome' | 'Edge' | 'Firefox' | 'Safari' | 'Opera' | 'Unknown'

export function detectDevice(): DeviceType {
  const ua = navigator.userAgent

  if (/Mobi|Android.*Mobile|iPhone|iPod|BlackBerry|Windows Phone|KFAPWI|IEMobile/i.test(ua)) {
    return 'Mobile'
  }

  if (/iPad|Tablet|Silk|Android(?!.*Mobile)|PlayBook|KFOT|KFTT/i.test(ua)) {
    return 'Tablet'
  }

  if (window.innerWidth >= 1024 || typeof navigator.maxTouchPoints !== 'undefined' && navigator.maxTouchPoints === 0) {
    if (/Windows NT|Mac OS X 10\.(1[5-9]|[2-9]\d)/.test(ua)) {
      return 'Desktop'
    }
  }

  return navigator.maxTouchPoints > 0 ? 'Laptop' : 'Desktop'
}

export function detectBrowser(): BrowserName {
  const ua = navigator.userAgent

  if (/Edg\//i.test(ua)) return 'Edge'
  if (/OPR|Opera/i.test(ua)) return 'Opera'
  if (/Chrome\/|CriOS\//i.test(ua) && !/Edg\//i.test(ua)) return 'Chrome'
  if (/Firefox|FxiOS/i.test(ua)) return 'Firefox'
  if (/Safari\//i.test(ua) && !/Chrome\/|CriOS\//i.test(ua)) return 'Safari'

  return 'Unknown'
}

export function getDeviceInfo() {
  return {
    device: detectDevice(),
    browser: detectBrowser(),
  }
}
