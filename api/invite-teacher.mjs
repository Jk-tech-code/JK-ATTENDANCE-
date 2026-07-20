// Vercel serverless function — invite teacher
// Uses Supabase inviteUserByEmail to send an invitation email
// Teacher sets their own password via the reset-password page

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

    // Duplicate checks
    const { data: existingAuth, error: listErr } = await supabase.auth.admin.listUsers()
    if (!listErr && existingAuth?.users?.some(u => u.email === input.email)) {
      return res.status(409).json({ error: 'A user with this email already exists' })
    }

    const { data: existingTeacher } = await supabase
      .from('teachers')
      .select('id')
      .or(`email.eq.${input.email},staff_number.eq.${input.staff_number}`)
      .maybeSingle()

    if (existingTeacher) {
      return res.status(409).json({ error: 'A teacher with this email or staff number already exists' })
    }

    // Send invitation
    const siteUrl = process.env.SITE_URL || 'https://jkattendance.vercel.app'
    console.log('[invite-teacher] Inviting:', input.email, 'redirectTo:', `${siteUrl}/reset-password`)

    const { data: inviteData, error: inviteError } = await supabase.auth.admin.inviteUserByEmail(input.email, {
      redirectTo: `${siteUrl}/reset-password`,
      data: { role: 'teacher', full_name: input.full_name },
    })

    if (inviteError || !inviteData.user) {
      console.error('[invite-teacher] inviteUserByEmail failed:', inviteError?.message)
      return res.status(400).json({ error: inviteError?.message || 'Failed to send invitation' })
    }

    const authUserId = inviteData.user.id

    // Create teacher record
    const { data: teacher, error: insertError } = await supabase
      .from('teachers')
      .insert({
        id: authUserId,
        user_id: authUserId,
        auth_user_id: authUserId,
        staff_number: input.staff_number,
        full_name: input.full_name,
        email: input.email,
        department: input.department || null,
        phone: input.phone || null,
        reporting_time: input.reporting_time || null,
        invited_at: new Date().toISOString(),
        invitation_sent: true,
      })
      .select()
      .single()

    if (insertError) {
      console.error('[invite-teacher] Insert failed, rolling back:', insertError.message)
      await supabase.auth.admin.deleteUser(authUserId).catch(() => {})
      return res.status(400).json({ error: insertError.message })
    }

    console.log('[invite-teacher] Success:', { teacher_id: teacher.id, email: input.email })
    return res.status(201).json({ teacher })
  } catch (err) {
    console.error('[invite-teacher] Unhandled error:', err)
    return res.status(500).json({ error: err.message })
  }
}
