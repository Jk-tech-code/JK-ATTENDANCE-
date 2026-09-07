import { supabase } from '@/services/supabase'
import type { SchoolHoliday } from '@/types'

export async function getHolidays(): Promise<SchoolHoliday[]> {
  const { data, error } = await supabase
    .from('school_holidays')
    .select('*')
    .order('date', { ascending: false })

  if (error) throw new Error(error.message)
  return data as SchoolHoliday[]
}

export async function createHoliday(input: {
  date: string
  description: string
}): Promise<SchoolHoliday> {
  const { data, error } = await supabase
    .from('school_holidays')
    .insert({ date: input.date, description: input.description })
    .select()
    .single()

  if (error) throw new Error(error.message)
  return data as SchoolHoliday
}

export async function deleteHoliday(id: string): Promise<void> {
  const { error } = await supabase.from('school_holidays').delete().eq('id', id)

  if (error) throw new Error(error.message)
}
