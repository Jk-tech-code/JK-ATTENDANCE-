import { describe, it, expect, beforeEach, vi } from 'vitest'

// Mock the supabase singleton so importing calendar.ts doesn't open
// a real connection. Tests below drive the rpc/from chain directly.
const mockRpc = vi.fn()
const mockGetUser = vi.fn()
const mockFrom = vi.fn()

vi.mock('@/services/supabase', () => ({
  supabase: {
    auth: { getUser: (...args: unknown[]) => mockGetUser(...args) },
    rpc: (...args: unknown[]) => mockRpc(...args),
    from: (...args: unknown[]) => mockFrom(...args),
  },
}))

// Import after the mock is in place.
const {
  createCalendarEntry,
  updateCalendarEntry,
  deleteCalendarEntry,
} = await import('./calendar')

function mockRpcSuccess(data: unknown) {
  mockRpc.mockResolvedValueOnce({ data, error: null })
}

function mockRpcError(code: string, message: string) {
  mockRpc.mockResolvedValueOnce({
    data: null,
    error: { code, message, details: '', hint: '' },
  })
}

describe('createCalendarEntry', () => {
  beforeEach(() => {
    mockGetUser.mockReset()
    mockRpc.mockReset()
    mockFrom.mockReset()
    mockGetUser.mockResolvedValue({ data: { user: { id: 'admin-1' } }, error: null })
  })

  it('throws when the user is not authenticated', async () => {
    mockGetUser.mockResolvedValueOnce({ data: { user: null }, error: null })
    await expect(
      createCalendarEntry({
        calendar_date: '2026-09-01',
        day_type: 'holiday',
        title: 'Test',
      }),
    ).rejects.toThrow(/Authentication required/)
  })

  it('returns the RPC row on success', async () => {
    const row = {
      id: 'row-1',
      calendar_date: '2026-09-01',
      day_type: 'holiday',
      title: 'Midterm',
      description: null,
      created_by: 'admin-1',
      created_at: '2026-08-01T00:00:00Z',
    }
    mockRpcSuccess([row])

    const result = await createCalendarEntry({
      calendar_date: '2026-09-01',
      day_type: 'holiday',
      title: 'Midterm',
    })

    expect(result).toEqual(row)
    expect(mockRpc).toHaveBeenCalledWith('create_calendar_entry', {
      p_calendar_date: '2026-09-01',
      p_day_type: 'holiday',
      p_title: 'Midterm',
      p_description: null,
      p_created_by: 'admin-1',
    })
  })

  it('surfaces a friendly error on a date collision (23505)', async () => {
    mockRpcError('23505', 'duplicate key value violates unique constraint')
    await expect(
      createCalendarEntry({
        calendar_date: '2026-09-01',
        day_type: 'holiday',
        title: 'Dup',
      }),
    ).rejects.toThrow(/already exists/)
  })

  it('surfaces a friendly error on an invalid day_type (22023)', async () => {
    mockRpcError('22023', 'Invalid day_type')
    await expect(
      createCalendarEntry({
        calendar_date: '2026-09-01',
        day_type: 'working_day',
        title: 'OK',
      }),
    ).rejects.toThrow(/Invalid day type/)
  })

  it('forwards the description when provided', async () => {
    mockRpcSuccess([
      {
        id: 'row-2',
        calendar_date: '2026-09-02',
        day_type: 'event',
        title: 'E',
        description: 'desc',
        created_by: 'admin-1',
        created_at: '2026-08-01T00:00:00Z',
      },
    ])
    await createCalendarEntry({
      calendar_date: '2026-09-02',
      day_type: 'event',
      title: 'E',
      description: 'desc',
    })
    expect(mockRpc).toHaveBeenCalledWith(
      'create_calendar_entry',
      expect.objectContaining({ p_description: 'desc' }),
    )
  })
})

describe('updateCalendarEntry', () => {
  beforeEach(() => {
    mockGetUser.mockReset()
    mockRpc.mockReset()
  })

  it('returns the updated row on success', async () => {
    mockRpcSuccess([
      {
        id: 'row-1',
        calendar_date: '2026-09-01',
        day_type: 'working_day',
        title: 'Working',
        description: null,
        created_by: 'admin-1',
        created_at: '2026-08-01T00:00:00Z',
      },
    ])
    const result = await updateCalendarEntry('row-1', { day_type: 'working_day' })
    expect(result.id).toBe('row-1')
    expect(mockRpc).toHaveBeenCalledWith('update_calendar_entry', {
      p_id: 'row-1',
      p_calendar_date: null,
      p_day_type: 'working_day',
      p_title: null,
      p_description: null,
    })
  })

  it('surfaces a friendly error when the row is missing (P0002)', async () => {
    mockRpcError('P0002', 'Calendar entry not found')
    await expect(updateCalendarEntry('missing', { title: 'x' })).rejects.toThrow(
      /not found/i,
    )
  })
})

describe('deleteCalendarEntry', () => {
  beforeEach(() => {
    mockRpc.mockReset()
  })

  it('returns void on success', async () => {
    mockRpcSuccess(true)
    await expect(deleteCalendarEntry('row-1')).resolves.toBeUndefined()
    expect(mockRpc).toHaveBeenCalledWith('delete_calendar_entry', { p_id: 'row-1' })
  })

  it('surfaces a friendly error when the row is missing', async () => {
    mockRpcError('P0002', 'Calendar entry not found')
    await expect(deleteCalendarEntry('missing')).rejects.toThrow(/not found/i)
  })
})