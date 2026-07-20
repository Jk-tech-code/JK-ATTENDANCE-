-- ============================================
-- JK Attendance - Migration 00018
-- Teacher Invitation System
-- Adds auth_user_id, invited_at, invitation_sent columns
-- ============================================

-- 1. ADD COLUMNS (idempotent)
ALTER TABLE teachers ADD COLUMN IF NOT EXISTS auth_user_id UUID REFERENCES auth.users(id);
ALTER TABLE teachers ADD COLUMN IF NOT EXISTS invited_at TIMESTAMPTZ;
ALTER TABLE teachers ADD COLUMN IF NOT EXISTS invitation_sent BOOLEAN DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_teachers_auth_user_id ON teachers(auth_user_id);

-- 2. BACKFILL auth_user_id from user_id (where user_id is already set)
UPDATE teachers
SET auth_user_id = user_id
WHERE user_id IS NOT NULL AND auth_user_id IS NULL;

-- 3. UPDATE RLS POLICIES to include auth_user_id
DROP POLICY IF EXISTS "Teachers read own profile" ON teachers;
CREATE POLICY "Teachers read own profile"
  ON teachers FOR SELECT
  TO authenticated
  USING (
    id = auth.uid()
    OR user_id = auth.uid()
    OR auth_user_id = auth.uid()
  );

DROP POLICY IF EXISTS "Teachers manage own attendance" ON attendance;
CREATE POLICY "Teachers manage own attendance"
  ON attendance FOR ALL
  TO authenticated
  USING (
    teacher_id IN (
      SELECT id FROM teachers
      WHERE id = auth.uid()
         OR user_id = auth.uid()
         OR auth_user_id = auth.uid()
    )
  )
  WITH CHECK (
    teacher_id IN (
      SELECT id FROM teachers
      WHERE id = auth.uid()
         OR user_id = auth.uid()
         OR auth_user_id = auth.uid()
    )
  );

-- 4. VERIFICATION QUERIES (run manually)
-- SELECT id, user_id, auth_user_id, invited_at, invitation_sent, email, full_name FROM teachers ORDER BY created_at DESC;
