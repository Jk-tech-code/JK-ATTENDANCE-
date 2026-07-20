// Netlify serverless function — invite teacher
// Uses Supabase inviteUserByEmail to send an invitation email
// Teacher sets their own password via the reset-password page

const { createClient } = require('@supabase/supabase-js')

exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
  }

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers, body: '' }
  }

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) }
  }

  try {
    const supabaseUrl = process.env.VITE_SUPABASE_URL
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY

    if (!supabaseUrl || !serviceRoleKey) {
      console.error('[invite-teacher] Missing env vars')
      return { statusCode: 500, headers, body: JSON.stringify({ error: 'Server configuration error' }) }
    }

    const supabase = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    })

    const token = event.headers.authorization?.replace('Bearer ', '')
    if (!token) {
      return { statusCode: 401, headers, body: JSON.stringify({ error: 'Not authenticated' }) }
    }

    const { data: { user }, error: userError } = await supabase.auth.getUser(token)
    if (userError || !user) {
      return { statusCode: 401, headers, body: JSON.stringify({ error: 'Invalid or expired token' }) }
    }
    if (user.user_metadata?.role !== 'admin') {
      return { statusCode: 403, headers, body: JSON.stringify({ error: 'Only admins can invite teachers' }) }
    }

    const input = JSON.parse(event.body)
    if (!input.staff_number || !input.full_name || !input.email) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'staff_number, full_name, and email are required' }) }
    }

    const siteUrl = process.env.SITE_URL || 'https://jkattendance.vercel.app'
    console.log('[invite-teacher] Inviting:', input.email, 'redirectTo:', `${siteUrl}/reset-password`)

    const { data: inviteData, error: inviteError } = await supabase.auth.admin.inviteUserByEmail(input.email, {
      redirectTo: `${siteUrl}/reset-password`,
    })

    if (inviteError || !inviteData.user) {
      console.error('[invite-teacher] inviteUserByEmail failed:', inviteError?.message)
      return { statusCode: 400, headers, body: JSON.stringify({ error: inviteError?.message || 'Failed to send invitation' }) }
    }

    const authUserId = inviteData.user.id
    console.log('[invite-teacher] Creating teacher record:', authUserId)

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
      return { statusCode: 400, headers, body: JSON.stringify({ error: insertError.message }) }
    }

    console.log('[invite-teacher] Success:', { teacher_id: teacher.id, email: input.email })
    return {
      statusCode: 201,
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ teacher }),
    }
  } catch (err) {
    console.error('[invite-teacher] Unhandled error:', err)
    return {
      statusCode: 500,
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: err.message }),
    }
  }
}
