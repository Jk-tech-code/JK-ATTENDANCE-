// Netlify serverless function — delete teacher
// Uses delete_teacher_cascade RPC for transaction-safe cleanup

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
      console.error('[delete-teacher] Missing env vars')
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
      return { statusCode: 403, headers, body: JSON.stringify({ error: 'Only admins can delete teachers' }) }
    }

    const { teacher_id } = JSON.parse(event.body)
    if (!teacher_id) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'teacher_id is required' }) }
    }

    console.log('[delete-teacher] Deleting:', teacher_id)

    const { data: result, error: fnError } = await supabase
      .rpc('delete_teacher_cascade', { p_teacher_id: teacher_id })
      .single()

    if (fnError) {
      console.error('[delete-teacher] RPC failed:', fnError.message)
      return { statusCode: 500, headers, body: JSON.stringify({ error: fnError.message }) }
    }

    if (!result?.success) {
      return { statusCode: 500, headers, body: JSON.stringify({ error: result?.error || 'Delete failed' }) }
    }

    console.log('[delete-teacher] Success:', result)
    return {
      statusCode: 200,
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ success: true }),
    }
  } catch (err) {
    console.error('[delete-teacher] Unhandled error:', err)
    return {
      statusCode: 500,
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: err.message }),
    }
  }
}
