// Vercel serverless function — invite teacher
// Same-origin, no CORS preflight. Uses service role key server-to-server.

import { createClient } from '@supabase/supabase-js'

function generatePassword() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789!@#$'
  let password = ''
  for (let i = 0; i < 12; i++) {
    password += chars.charAt(Math.floor(Math.random() * chars.length))
  }
  return password
}

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
      console.error('[invite-teacher] Missing env vars')
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
      return res.status(403).json({ error: 'Only admins can invite teachers' })
    }

    const input = req.body
    if (!input.staff_number || !input.full_name || !input.email) {
      return res.status(400).json({ error: 'staff_number, full_name, and email are required' })
    }

    const tempPassword = generatePassword()
    console.log('[invite-teacher] Creating auth user:', input.email)

    const { data: authUser, error: createError } = await supabase.auth.admin.createUser({
      email: input.email,
      password: tempPassword,
      email_confirm: true,
      user_metadata: { role: 'teacher', full_name: input.full_name },
    })

    if (createError || !authUser.user) {
      console.error('[invite-teacher] createUser failed:', createError?.message)
      return res.status(400).json({ error: createError?.message || 'Failed to create auth user' })
    }

    console.log('[invite-teacher] Creating teacher record:', authUser.user.id)

    const { data: teacher, error: insertError } = await supabase
      .from('teachers')
      .insert({
        id: authUser.user.id,
        user_id: authUser.user.id,
        staff_number: input.staff_number,
        full_name: input.full_name,
        email: input.email,
        department: input.department || null,
        phone: input.phone || null,
        reporting_time: input.reporting_time || null,
      })
      .select()
      .single()

    if (insertError) {
      console.error('[invite-teacher] Insert failed, rolling back:', insertError.message)
      await supabase.auth.admin.deleteUser(authUser.user.id).catch(() => {})
      return res.status(400).json({ error: insertError.message })
    }

    console.log('[invite-teacher] Success:', { teacher_id: teacher.id, email: input.email })
    return res.status(201).json({ teacher, tempPassword })
  } catch (err) {
    console.error('[invite-teacher] Unhandled error:', err)
    return res.status(500).json({ error: err.message })
  }
}
