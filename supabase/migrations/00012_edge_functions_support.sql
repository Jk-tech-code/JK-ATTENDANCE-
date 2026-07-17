-- ============================================
-- JK Attendance - Migration 00012
-- Edge Functions support: notifications table
-- ============================================

-- ============================================
-- 1. ATTENDANCE NOTIFICATIONS TABLE
-- ============================================
CREATE TABLE IF NOT EXISTS attendance_notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  teacher_id UUID REFERENCES teachers(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('missed_check_in', 'late_check_in', 'absent', 'reminder')),
  message TEXT NOT NULL,
  date DATE NOT NULL DEFAULT CURRENT_DATE,
  channel TEXT NOT NULL DEFAULT 'email' CHECK (channel IN ('email', 'sms', 'push', 'in_app')),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'failed', 'read')),
  sent_at TIMESTAMPTZ,
  read_at TIMESTAMPTZ,
  error_message TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE attendance_notifications ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Admins read notifications') THEN
    CREATE POLICY "Admins read notifications"
      ON attendance_notifications FOR SELECT TO authenticated
      USING (
        EXISTS (SELECT 1 FROM auth.users WHERE id = auth.uid() AND raw_user_meta_data->>'role' = 'admin')
      );
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Admins insert notifications') THEN
    CREATE POLICY "Admins insert notifications"
      ON attendance_notifications FOR INSERT TO authenticated
      WITH CHECK (
        EXISTS (SELECT 1 FROM auth.users WHERE id = auth.uid() AND raw_user_meta_data->>'role' = 'admin')
      );
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Teachers read own notifications') THEN
    CREATE POLICY "Teachers read own notifications"
      ON attendance_notifications FOR SELECT TO authenticated
      USING (teacher_id = auth.uid());
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_notifications_teacher_id ON attendance_notifications(teacher_id);
CREATE INDEX IF NOT EXISTS idx_notifications_date ON attendance_notifications(date);
CREATE INDEX IF NOT EXISTS idx_notifications_status ON attendance_notifications(status);

-- ============================================
-- 2. FUNCTION: get_attendance_analytics
-- Prepares data for the AI analysis function
-- ============================================
CREATE OR REPLACE FUNCTION get_attendance_analytics(
  p_year INTEGER DEFAULT EXTRACT(YEAR FROM CURRENT_DATE),
  p_month INTEGER DEFAULT EXTRACT(MONTH FROM CURRENT_DATE),
  p_teacher_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_start_date DATE;
  v_end_date DATE;
  v_result JSONB;
BEGIN
  v_start_date := make_date(p_year, p_month, 1);
  v_end_date := (v_start_date + INTERVAL '1 month' - INTERVAL '1 day')::DATE;

  WITH teacher_stats AS (
    SELECT
      t.id AS teacher_id,
      t.full_name,
      t.staff_number,
      COUNT(a.id) AS total_days,
      COUNT(a.id) FILTER (WHERE a.status IN ('present', 'checked_out')) AS present_days,
      COUNT(a.id) FILTER (WHERE a.status = 'late') AS late_days,
      COUNT(a.id) FILTER (WHERE a.status = 'absent') AS absent_days,
      COALESCE(ROUND(AVG(a.late_minutes) FILTER (WHERE a.status = 'late')), 0) AS avg_late_minutes,
      COALESCE(ROUND(AVG(a.working_minutes) FILTER (WHERE a.working_minutes IS NOT NULL)), 0) AS avg_working_minutes,
      CASE
        WHEN COUNT(a.id) > 0
        THEN ROUND(
          (COUNT(a.id) FILTER (WHERE a.status IN ('present', 'checked_out', 'late')))::NUMERIC
          / COUNT(a.id) * 100
        )
        ELSE 0
      END AS attendance_percentage
    FROM teachers t
    LEFT JOIN attendance a ON a.teacher_id = t.id
      AND a.attendance_date BETWEEN v_start_date AND v_end_date
    WHERE t.employment_status = 'active'
      AND (p_teacher_id IS NULL OR t.id = p_teacher_id)
    GROUP BY t.id, t.full_name, t.staff_number
  )
  SELECT jsonb_build_object(
    'period', jsonb_build_object('year', p_year, 'month', p_month, 'start', v_start_date, 'end', v_end_date),
    'teachers', COALESCE(jsonb_agg(ts ORDER BY ts.attendance_percentage ASC), '[]'::jsonb),
    'summary', (
      SELECT jsonb_build_object(
        'total_teachers', COUNT(*),
        'avg_attendance_rate', ROUND(AVG(attendance_percentage)),
        'frequent_late_count', COUNT(*) FILTER (WHERE late_days >= 3),
        'high_absent_count', COUNT(*) FILTER (WHERE absent_days >= 2)
      )
      FROM teacher_stats
    )
  ) INTO v_result
  FROM teacher_stats ts;

  RETURN v_result;
END;
$$;

-- ============================================
-- 3. INDEXES FOR EDGE FUNCTION QUERIES
-- ============================================
CREATE INDEX IF NOT EXISTS idx_attendance_status_date ON attendance(status, attendance_date);
CREATE INDEX IF NOT EXISTS idx_teachers_employment_status ON teachers(employment_status);
