// Netlify serverless function — invite teacher
// Bypasses Supabase Edge Function gateway CORS issue (always returns 500 for OPTIONS)
// Runs server-to-server with service role key

const { createClient } = require('@supabase/supabase-js')

function generatePassword() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789!@#$'
  let password = ''
  for (let i = 0; i < 12; i++) {
    password += chars.charAt(Math.floor(Math.random() * chars.length))
  }
  return password
}

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
      console.error('[invite-teacher-proxy] Missing env vars')
      return { statusCode: 500, headers, body: JSON.stringify({ error: 'Server configuration error' }) }
    }

    const supabase = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    })

    // Verify caller is authenticated and is admin
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

    // Parse input
    const input = JSON.parse(event.body)
    if (!input.staff_number || !input.full_name || !input.email) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'staff_number, full_name, and email are required' }) }
    }

    // Create auth user
    const tempPassword = generatePassword()
    console.log('[invite-teacher-proxy] Creating auth user:', input.email)

    const { data: authUser, error: createError } = await supabase.auth.admin.createUser({
      email: input.email,
      password: tempPassword,
      email_confirm: true,
      user_metadata: { role: 'teacher', full_name: input.full_name },
    })

    if (createError) {
      console.error('[invite-teacher-proxy] createUser failed:', createError.message)
      return { statusCode: 400, headers, body: JSON.stringify({ error: createError.message }) }
    }
    if (!authUser.user) {
      return { statusCode: 500, headers, body: JSON.stringify({ error: 'Failed to create auth user' }) }
    }

    // Insert teacher record
    console.log('[invite-teacher-proxy] Creating teacher record:', authUser.user.id)

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
      console.error('[invite-teacher-proxy] Teacher insert failed, rolling back:', insertError.message)
      await supabase.auth.admin.deleteUser(authUser.user.id).catch(() => {})
      return { statusCode: 400, headers, body: JSON.stringify({ error: insertError.message }) }
    }

    console.log('[invite-teacher-proxy] Success:', { teacher_id: teacher.id, email: input.email })
    return {
      statusCode: 201,
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ teacher, tempPassword }),
    }
  } catch (err) {
    console.error('[invite-teacher-proxy] Unhandled error:', err)
    return {
      statusCode: 500,
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: err.message }),
    }
  }
}
