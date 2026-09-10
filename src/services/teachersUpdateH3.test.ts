import { describe, it, expect, vi, beforeEach } from 'vitest'
import { updateTeacher } from './admin/teachers'

vi.mock('@/services/supabase', () => ({
  supabase: {
    from: vi.fn(),
  },
}))

import { supabase } from '@/services/supabase'

describe('H3 defense-in-depth: updateTeacher strips role', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  function mockUpdateChain() {
    const single = vi.fn().mockResolvedValue({ data: { id: 't1' }, error: null })
    const select = vi.fn().mockReturnValue({ single })
    const eq = vi.fn().mockReturnValue({ select })
    const update = vi.fn().mockReturnValue({ eq })
    ;(supabase.from as ReturnType<typeof vi.fn>).mockReturnValue({ update })
    return { update }
  }

  it('TEST C: legitimate non-role field updates still flow through', async () => {
    const { update } = mockUpdateChain()
    await updateTeacher('t1', { full_name: 'Jane Doe', employment_status: 'active' })
    expect(update).toHaveBeenCalledWith({ full_name: 'Jane Doe', employment_status: 'active' })
  })

  it('TEST A/B/G/H: role is stripped even if a caller passes it', async () => {
    const { update } = mockUpdateChain()
    await updateTeacher('t1', {
      full_name: 'Jane Doe',
      role: 'superadmin',
    } as unknown as Parameters<typeof updateTeacher>[1])
    const sent = (update as ReturnType<typeof vi.fn>).mock.calls[0][0] as Record<string, unknown>
    expect(sent).not.toHaveProperty('role')
    expect(sent).toEqual({ full_name: 'Jane Doe' })
  })
})
