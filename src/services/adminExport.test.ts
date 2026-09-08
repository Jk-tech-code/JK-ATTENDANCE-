import { describe, it, expect, vi } from 'vitest'

vi.mock('../supabase', () => ({
  supabase: {},
}))

import { POSTGREST_MAX_PAGE_SIZE, pageAllAttendance } from './admin'

type AttendanceWithTeacher = {
  attendance_date: string
  status: string | null
  teacher: { full_name: string; staff_number: string } | null
}

const makeRecord = (i: number): AttendanceWithTeacher => ({
  attendance_date: `2026-01-${String(i).padStart(2, '0')}`,
  status: 'present',
  teacher: { full_name: `Teacher ${i}`, staff_number: `S${i}` },
})

describe('pageAllAttendance (PostgREST 1000-row cap fix)', () => {
  it('exports POSTGREST_MAX_PAGE_SIZE = 1000', () => {
    expect(POSTGREST_MAX_PAGE_SIZE).toBe(1000)
  })

  it('returns the single page when total <= page size', async () => {
    const rows = Array.from({ length: 50 }, (_, i) => makeRecord(i + 1))
    const fetchPage = vi.fn().mockResolvedValueOnce({ records: rows })

    const out = await pageAllAttendance({}, fetchPage as never)
    expect(out).toHaveLength(50)
    expect(fetchPage).toHaveBeenCalledTimes(1)
    expect(fetchPage).toHaveBeenCalledWith({
      page: 1,
      page_size: POSTGREST_MAX_PAGE_SIZE,
    })
  })

  it('pages through >1000 records without truncation', async () => {
    const fullPage1 = Array.from({ length: POSTGREST_MAX_PAGE_SIZE }, (_, i) => makeRecord(i + 1))
    const fullPage2 = Array.from({ length: POSTGREST_MAX_PAGE_SIZE }, (_, i) =>
      makeRecord(i + 1 + POSTGREST_MAX_PAGE_SIZE)
    )
    const partialPage3 = Array.from({ length: 237 }, (_, i) =>
      makeRecord(i + 1 + POSTGREST_MAX_PAGE_SIZE * 2)
    )

    const fetchPage = vi
      .fn()
      .mockResolvedValueOnce({ records: fullPage1 })
      .mockResolvedValueOnce({ records: fullPage2 })
      .mockResolvedValueOnce({ records: partialPage3 })

    const out = await pageAllAttendance({}, fetchPage as never)
    expect(out).toHaveLength(2237)
    expect(fetchPage).toHaveBeenCalledTimes(3)
    expect(fetchPage.mock.calls[0]?.[0]?.page).toBe(1)
    expect(fetchPage.mock.calls[1]?.[0]?.page).toBe(2)
    expect(fetchPage.mock.calls[2]?.[0]?.page).toBe(3)
  })

  it('stops when a page returns fewer rows than the cap (no infinite loop)', async () => {
    const fullPage = Array.from({ length: POSTGREST_MAX_PAGE_SIZE }, (_, i) => makeRecord(i + 1))
    const halfPage = Array.from({ length: 500 }, (_, i) =>
      makeRecord(i + 1 + POSTGREST_MAX_PAGE_SIZE)
    )

    const fetchPage = vi
      .fn()
      .mockResolvedValueOnce({ records: fullPage })
      .mockResolvedValueOnce({ records: halfPage })

    const out = await pageAllAttendance({}, fetchPage as never)
    expect(out).toHaveLength(1500)
    expect(fetchPage).toHaveBeenCalledTimes(2)
  })

  it('handles zero results', async () => {
    const fetchPage = vi.fn().mockResolvedValueOnce({ records: [] })

    const out = await pageAllAttendance({}, fetchPage as never)
    expect(out).toEqual([])
    expect(fetchPage).toHaveBeenCalledTimes(1)
  })

  it('forwards filters to every page request', async () => {
    const fetchPage = vi
      .fn()
      .mockResolvedValueOnce({ records: [makeRecord(1)] })
      .mockResolvedValueOnce({ records: [] })

    await pageAllAttendance({ date: '2026-01-01', teacher_id: 't-1' }, fetchPage as never)
    expect(fetchPage.mock.calls[0]?.[0]).toMatchObject({
      date: '2026-01-01',
      teacher_id: 't-1',
      page: 1,
      page_size: POSTGREST_MAX_PAGE_SIZE,
    })
  })

  it('throws if the page fetcher rejects', async () => {
    const fetchPage = vi.fn().mockRejectedValueOnce(new Error('network down'))
    await expect(pageAllAttendance({}, fetchPage as never)).rejects.toThrow('network down')
  })
})
