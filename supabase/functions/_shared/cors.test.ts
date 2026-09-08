import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import '../_shared/denoShim'

import { handleCors, jsonResponse, corsHeaders } from '../_shared/cors'

describe('handleCors', () => {
  const ORIGINAL_ENV = { ...process.env }

  beforeEach(() => {
    // Wipe per-test.
    for (const k of Object.keys(process.env)) {
      if (k === 'CORS_ORIGIN') delete process.env[k]
    }
  })

  afterEach(() => {
    // Restore from snapshot.
    for (const k of Object.keys(process.env)) {
      if (!(k in ORIGINAL_ENV)) delete process.env[k]
    }
    for (const k of Object.keys(ORIGINAL_ENV)) {
      process.env[k] = ORIGINAL_ENV[k]!
    }
  })

  function makeRequest(method: string, origin?: string): Request {
    const headers: Record<string, string> = {}
    if (origin) headers['origin'] = origin
    return new Request('https://example.com', { method, headers })
  }

  it('handles OPTIONS preflight with 204 and configured CORS headers', () => {
    const req = makeRequest('OPTIONS', 'https://app.example.com')
    const res = handleCors(req)
    expect(res).not.toBeNull()
    expect(res!.status).toBe(204)
    // Default fallback is the vercel.app origin when CORS_ORIGIN is unset.
    expect(res!.headers.get('Access-Control-Allow-Origin')).toBe('https://jk-attendance.vercel.app')
    expect(res!.headers.get('Access-Control-Allow-Methods')).toContain('OPTIONS')
  })

  it('returns null for non-OPTIONS when origin matches configured CORS_ORIGIN', () => {
    process.env.CORS_ORIGIN = 'https://app.example.com'
    const req = makeRequest('POST', 'https://app.example.com')
    expect(handleCors(req)).toBeNull()
  })

  it('rejects a request whose Origin header does not match CORS_ORIGIN', () => {
    process.env.CORS_ORIGIN = 'https://app.example.com'
    const req = makeRequest('POST', 'https://evil.example.com')
    const res = handleCors(req)
    expect(res).not.toBeNull()
    expect(res!.status).toBe(403)
  })

  it('falls back to the hardcoded jk-attendance.vercel.app origin when CORS_ORIGIN is unset', () => {
    // No CORS_ORIGIN set.
    const req = makeRequest('GET')
    expect(handleCors(req)).toBeNull()
    const headers = corsHeaders()
    expect(headers['Access-Control-Allow-Origin']).toBe('https://jk-attendance.vercel.app')
  })
})

describe('jsonResponse', () => {
  it('serialises a JSON body and applies CORS headers', async () => {
    const res = jsonResponse({ hello: 'world' }, 201)
    expect(res.status).toBe(201)
    expect(res.headers.get('Content-Type')).toBe('application/json')
    const body = await res.json()
    expect(body).toEqual({ hello: 'world' })
  })

  it('defaults to status 200', () => {
    const res = jsonResponse({ ok: true })
    expect(res.status).toBe(200)
  })
})
