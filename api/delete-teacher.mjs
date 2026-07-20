// Vercel serverless function — delete teacher
// Uses delete_teacher_cascade RPC for transaction-safe cleanup

import { createClient } from '@supabase/supabase-js'

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')

  if (req.method === 'OPTIONS') {
    return res.status(204).end()
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  try {
    const supabaseUrl = process.env.VITE_SUPABASE_URL
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY

    if (!supabaseUrl || !serviceRoleKey) {
      console.error('[delete-teacher] Missing env vars')
      return res.status(500).json({ error: 'Server configuration error' })
    }

    const supabase = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    })

    const token = req.headers.authorization?.replace('Bearer ', '')
    if (!token) {
      return res.status(401).json({ error: 'Not authenticated' })
    }

    const { data: { user }, error: userError } = await supabase.auth.getUser(token)
    if (userError || !user) {
      return res.status(401).json({ error: 'Invalid or expired token' })
    }
    if (user.user_metadata?.role !== 'admin') {
      return res.status(403).json({ error: 'Only admins can delete teachers' })
    }

    const { teacher_id } = req.body
    if (!teacher_id) {
      return res.status(400).json({ error: 'teacher_id is required' })
    }

    console.log('[delete-teacher] Deleting:', teacher_id)

    const { data: result, error: fnError } = await supabase
      .rpc('delete_teacher_cascade', { p_teacher_id: teacher_id })
      .single()

    if (fnError) {
      console.error('[delete-teacher] RPC failed:', fnError.message)
      return res.status(500).json({ error: fnError.message })
    }

    if (!result?.success) {
      return res.status(500).json({ error: result?.error || 'Delete failed' })
    }

    console.log('[delete-teacher] Success:', result)
    return res.status(200).json({ success: true })
  } catch (err) {
    console.error('[delete-teacher] Unhandled error:', err)
    return res.status(500).json({ error: err.message })
  }
}
