-- ============================================
-- JK Attendance - Migration 00032
-- Comprehensive RLS fix for ALL tables
-- ============================================

-- ============================================
-- 0. ENSURE ALL TABLES EXIST FIRST
-- ============================================
CREATE TABLE IF NOT EXISTS audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id UUID NOT NULL,
  action TEXT NOT NULL CHECK (action IN ('INSERT', 'UPDATE', 'DELETE')),
  target_type TEXT NOT NULL,
  target_id UUID NOT NULL,
  old_data JSONB,
  new_data JSONB,
  ip_address TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);
ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS report_store (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  report_type TEXT NOT NULL,
  period_start DATE NOT NULL,
  period_end DATE NOT NULL,
  data JSONB NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);
ALTER TABLE report_store ENABLE ROW LEVEL SECURITY;

-- ============================================
-- 1. DROP ALL EXISTING POLICIES (clean slate)
-- ============================================
DROP POLICY IF EXISTS "Teachers read own profile" ON teachers;
DROP POLICY IF EXISTS "Teachers read own profile (id match)" ON teachers;
DROP POLICY IF EXISTS "Teachers read own profile (user_id match)" ON teachers;
DROP POLICY IF EXISTS "Teachers read own profile (auth_user_id match)" ON teachers;
DROP POLICY IF EXISTS "Admins read all teachers" ON teachers;
DROP POLICY IF EXISTS "Admins insert teachers" ON teachers;
DROP POLICY IF EXISTS "Admins update teachers" ON teachers;
DROP POLICY IF EXISTS "Admins delete teachers" ON teachers;
DROP POLICY IF EXISTS "Admins manage teachers" ON teachers;
DROP POLICY IF EXISTS "Enable admin full access" ON teachers;

DROP POLICY IF EXISTS "Teachers manage own attendance" ON attendance;
DROP POLICY IF EXISTS "Teachers manage own attendance (id match)" ON attendance;
DROP POLICY IF EXISTS "Teachers manage own attendance (user_id match)" ON attendance;
DROP POLICY IF EXISTS "Teachers manage own attendance (auth_user_id match)" ON attendance;
DROP POLICY IF EXISTS "Admins read all attendance" ON attendance;
DROP POLICY IF EXISTS "Admins manage attendance" ON attendance;

DROP POLICY IF EXISTS "Authenticated users read school settings" ON school_settings;
DROP POLICY IF EXISTS "Admins read school settings" ON school_settings;
DROP POLICY IF EXISTS "Admins insert school settings" ON school_settings;
DROP POLICY IF EXISTS "Admins update school settings" ON school_settings;
DROP POLICY IF EXISTS "Admins delete school settings" ON school_settings;
DROP POLICY IF EXISTS "Admins manage school settings" ON school_settings;

DROP POLICY IF EXISTS "Authenticated users read school holidays" ON school_holidays;
DROP POLICY IF EXISTS "Admins manage school holidays" ON school_holidays;
DROP POLICY IF EXISTS "Admins manage school_holidays" ON school_holidays;

DROP POLICY IF EXISTS "Everyone read school_calendar" ON school_calendar;
DROP POLICY IF EXISTS "Admins insert school_calendar" ON school_calendar;
DROP POLICY IF EXISTS "Admins update school_calendar" ON school_calendar;
DROP POLICY IF EXISTS "Admins delete school_calendar" ON school_calendar;

DROP POLICY IF EXISTS "Admins read attendance_notifications" ON attendance_notifications;
DROP POLICY IF EXISTS "Admins insert attendance_notifications" ON attendance_notifications;
DROP POLICY IF EXISTS "Teachers read own notifications" ON attendance_notifications;

DROP POLICY IF EXISTS "Admins read audit logs" ON audit_logs;

DROP POLICY IF EXISTS "Admins read report_store" ON report_store;
DROP POLICY IF EXISTS "No insert for regular users" ON report_store;

-- ============================================
-- 2. REBUILD is_teacher_owner() FUNCTION
-- Checks id/user_id/auth_user_id for flexibility
-- Must DROP first because param name changed from check_teacher_id
-- ============================================
DROP FUNCTION IF EXISTS public.is_teacher_owner(UUID);
CREATE FUNCTION public.is_teacher_owner(p_teacher_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = 'public, auth'
AS $$
  SELECT EXISTS (
    SELECT 1 FROM teachers
    WHERE id = p_teacher_id
      AND (id = auth.uid() OR user_id = auth.uid() OR auth_user_id = auth.uid())
    LIMIT 1
  );
$$;

-- ============================================
-- 3. TEACHERS POLICIES
-- ============================================
CREATE POLICY "Teachers read own profile"
  ON teachers FOR SELECT
  TO authenticated
  USING (id = auth.uid() OR user_id = auth.uid() OR auth_user_id = auth.uid());

CREATE POLICY "Admins read all teachers"
  ON teachers FOR SELECT
  TO authenticated
  USING (public.is_admin());

CREATE POLICY "Admins insert teachers"
  ON teachers FOR INSERT
  TO authenticated
  WITH CHECK (public.is_admin());

CREATE POLICY "Admins update teachers"
  ON teachers FOR UPDATE
  TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

CREATE POLICY "Admins delete teachers"
  ON teachers FOR DELETE
  TO authenticated
  USING (public.is_admin());

-- ============================================
-- 4. ATTENDANCE POLICIES
-- ============================================
CREATE POLICY "Teachers manage own attendance"
  ON attendance FOR ALL
  TO authenticated
  USING (teacher_id IN (
    SELECT id FROM teachers
    WHERE id = auth.uid() OR user_id = auth.uid() OR auth_user_id = auth.uid()
  ))
  WITH CHECK (teacher_id IN (
    SELECT id FROM teachers
    WHERE id = auth.uid() OR user_id = auth.uid() OR auth_user_id = auth.uid()
  ));

CREATE POLICY "Admins read all attendance"
  ON attendance FOR SELECT
  TO authenticated
  USING (public.is_admin());

-- ============================================
-- 5. SCHOOL SETTINGS POLICIES (admin only)
-- ============================================
CREATE POLICY "Admins read school settings"
  ON school_settings FOR SELECT
  TO authenticated
  USING (public.is_admin());

CREATE POLICY "Admins insert school settings"
  ON school_settings FOR INSERT
  TO authenticated
  WITH CHECK (public.is_admin());

CREATE POLICY "Admins update school settings"
  ON school_settings FOR UPDATE
  TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

CREATE POLICY "Admins delete school settings"
  ON school_settings FOR DELETE
  TO authenticated
  USING (public.is_admin());

-- ============================================
-- 6. SCHOOL HOLIDAYS POLICIES
-- ============================================
CREATE POLICY "Everyone read school holidays"
  ON school_holidays FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Admins manage school holidays"
  ON school_holidays FOR ALL
  TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

-- ============================================
-- 7. SCHOOL CALENDAR POLICIES
-- ============================================
CREATE POLICY "Everyone read school_calendar"
  ON school_calendar FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Admins insert school_calendar"
  ON school_calendar FOR INSERT
  TO authenticated
  WITH CHECK (public.is_admin());

CREATE POLICY "Admins update school_calendar"
  ON school_calendar FOR UPDATE
  TO authenticated
  USING (public.is_admin());

CREATE POLICY "Admins delete school_calendar"
  ON school_calendar FOR DELETE
  TO authenticated
  USING (public.is_admin());

-- ============================================
-- 8. ATTENDANCE NOTIFICATIONS POLICIES
-- ============================================
CREATE POLICY "Admins read attendance_notifications"
  ON attendance_notifications FOR SELECT
  TO authenticated
  USING (public.is_admin());

CREATE POLICY "Admins insert attendance_notifications"
  ON attendance_notifications FOR INSERT
  TO authenticated
  WITH CHECK (public.is_admin());

CREATE POLICY "Teachers read own notifications"
  ON attendance_notifications FOR SELECT
  TO authenticated
  USING (public.is_teacher_owner(teacher_id));

-- ============================================
-- 9. AUDIT LOGS POLICIES (admin only)
-- ============================================
CREATE POLICY "Admins read audit logs"
  ON audit_logs FOR SELECT
  TO authenticated
  USING (public.is_admin());

-- ============================================
-- 10. REPORT STORE POLICIES (admin only)
-- ============================================
CREATE POLICY "Admins read report_store"
  ON report_store FOR SELECT
  TO authenticated
  USING (public.is_admin());

CREATE POLICY "Admins insert report_store"
  ON report_store FOR INSERT
  TO authenticated
  WITH CHECK (public.is_admin());

-- ============================================
-- 11. REQUIRED INDEXES
-- ============================================
CREATE INDEX IF NOT EXISTS idx_teachers_user_id ON teachers(user_id);
CREATE INDEX IF NOT EXISTS idx_teachers_auth_user_id ON teachers(auth_user_id);
CREATE INDEX IF NOT EXISTS idx_teachers_role ON teachers(role);
CREATE INDEX IF NOT EXISTS idx_attendance_teacher_id ON attendance(teacher_id);
CREATE INDEX IF NOT EXISTS idx_attendance_date ON attendance(attendance_date);
CREATE INDEX IF NOT EXISTS idx_attendance_status ON attendance(status);
CREATE INDEX IF NOT EXISTS idx_attendance_teacher_date ON attendance(teacher_id, attendance_date);
CREATE INDEX IF NOT EXISTS idx_notifications_teacher_id ON attendance_notifications(teacher_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_actor ON audit_logs(actor_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_target ON audit_logs(target_type, target_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_created ON audit_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_school_calendar_date ON school_calendar(calendar_date);
CREATE INDEX IF NOT EXISTS idx_report_store_type ON report_store(report_type);
CREATE INDEX IF NOT EXISTS idx_report_store_period ON report_store(period_start, period_end);
