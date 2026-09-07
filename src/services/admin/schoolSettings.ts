import { supabase } from '@/services/supabase'
import type { SchoolSettings } from '@/types'

export async function getSchoolSettings(): Promise<SchoolSettings | null> {
  const { data, error } = await supabase.from('school_settings').select('*').maybeSingle()

  if (error) throw new Error(error.message)
  return data as SchoolSettings | null
}

export async function updateSchoolSettings(
  input: Partial<{
    school_name: string
    latitude: number
    longitude: number
    allowed_radius: number
    default_reporting_time: string
  }>
): Promise<SchoolSettings> {
  // Fetch current settings ID first
  const current = await supabase.from('school_settings').select('id').limit(1).maybeSingle()

  const settingsId = current.data?.id
  if (!settingsId) throw new Error('School settings not found')

  const { data, error } = await supabase
    .from('school_settings')
    .update(input)
    .eq('id', settingsId)
    .select()
    .single()

  if (error) throw new Error(error.message)
  return data as SchoolSettings
}
