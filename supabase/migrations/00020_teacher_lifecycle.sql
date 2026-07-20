-- ============================================
-- JK Attendance - Migration 00020
-- Teacher Lifecycle Management
-- CASCADE deletes, delete_teacher_cascade function
-- ============================================

-- ============================================
-- PART 1: Ensure all FK constraints have CASCADE
-- ============================================
-- WHY: When a teacher is deleted, all related records
-- (attendance, notifications) must be auto-deleted.
-- These should already exist from 00001 and 00012,
-- but we ensure they are present.
-- ============================================

-- attendance.teacher_id → teachers(id) CASCADE
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints tc
    JOIN information_schema.key_column_usage kcu ON tc.constraint_name = kcu.constraint_name
    WHERE tc.table_name = 'attendance'
      AND kcu.column_name = 'teacher_id'
      AND tc.constraint_type = 'FOREIGN KEY'
  ) THEN
    ALTER TABLE attendance
      ADD CONSTRAINT fk_attendance_teacher
      FOREIGN KEY (teacher_id) REFERENCES teachers(id)
      ON DELETE CASCADE;
  END IF;
END $$;

-- attendance_notifications.teacher_id → teachers(id) CASCADE
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints tc
    JOIN information_schema.key_column_usage kcu ON tc.constraint_name = kcu.constraint_name
    WHERE tc.table_name = 'attendance_notifications'
      AND kcu.column_name = 'teacher_id'
      AND tc.constraint_type = 'FOREIGN KEY'
  ) THEN
    ALTER TABLE attendance_notifications
      ADD CONSTRAINT fk_notifications_teacher
      FOREIGN KEY (teacher_id) REFERENCES teachers(id)
      ON DELETE CASCADE;
  END IF;
END $$;

-- ============================================
-- PART 2: delete_teacher_cascade()
-- ============================================
-- WHY: Deletes a teacher and ALL related data in a single
-- transaction-safe call. Handles auth user deletion too.
-- Run with service_role key (by edge function).
--
-- Steps:
--   1. Capture auth_user_id before deletion
--   2. Delete teacher record (CASCADE handles attendance, notifications)
--   3. Delete auth user from auth.users
--
-- SECURITY DEFINER: lets the edge function call this with
--   service_role and have it run with full privileges.
-- ============================================

CREATE OR REPLACE FUNCTION public.delete_teacher_cascade(p_teacher_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_auth_user_id UUID;
  v_teacher_email TEXT;
  v_teacher_name TEXT;
BEGIN
  -- Capture teacher info before deletion
  SELECT auth_user_id, email, full_name INTO v_auth_user_id, v_teacher_email, v_teacher_name
  FROM public.teachers
  WHERE id = p_teacher_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Teacher not found');
  END IF;

  -- Delete teacher record (CASCADE handles attendance, notifications)
  DELETE FROM public.teachers WHERE id = p_teacher_id;

  -- Delete auth user if linked
  IF v_auth_user_id IS NOT NULL THEN
    DELETE FROM auth.users WHERE id = v_auth_user_id;
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'deleted_teacher', p_teacher_id,
    'deleted_auth_user', v_auth_user_id
  );
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$;

COMMENT ON FUNCTION public.delete_teacher_cascade(UUID) IS
  'Deletes a teacher record (CASCADE drops attendance, notifications) and the linked auth user. SECURITY DEFINER.';

-- ============================================
-- PART 3: Check for duplicate before invite
-- ============================================
-- WHY: Prevent duplicate invites by checking existing
-- auth users AND teacher records in one call.
-- ============================================

CREATE OR REPLACE FUNCTION public.check_teacher_available(p_email TEXT, p_staff_number TEXT)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_result JSONB;
BEGIN
  -- Check if auth user exists
  IF EXISTS (SELECT 1 FROM auth.users WHERE email = p_email) THEN
    RETURN jsonb_build_object(
      'available', false,
      'reason', 'A user with this email already exists'
    );
  END IF;

  -- Check if teacher record exists with this email
  IF EXISTS (SELECT 1 FROM public.teachers WHERE email = p_email) THEN
    RETURN jsonb_build_object(
      'available', false,
      'reason', 'A teacher with this email already exists'
    );
  END IF;

  -- Check if staff number is taken
  IF EXISTS (SELECT 1 FROM public.teachers WHERE staff_number = p_staff_number) THEN
    RETURN jsonb_build_object(
      'available', false,
      'reason', 'This staff number is already assigned'
    );
  END IF;

  RETURN jsonb_build_object('available', true);
END;
$$;

COMMENT ON FUNCTION public.check_teacher_available(TEXT, TEXT) IS
  'Checks if a teacher email and staff number are available for invitation.';

-- ============================================
-- PART 4: Ensure indexes for performance
-- ============================================

CREATE INDEX IF NOT EXISTS idx_teachers_email ON teachers(email);
CREATE INDEX IF NOT EXISTS idx_teachers_staff_number ON teachers(staff_number);

-- ============================================
-- VERIFICATION (run after applying):
-- ============================================
-- SELECT table_name, constraint_name, delete_rule
-- FROM information_schema.referential_constraints rc
-- JOIN information_schema.table_constraints tc ON rc.constraint_name = tc.constraint_name
-- WHERE tc.table_name IN ('attendance', 'attendance_notifications')
--   AND tc.constraint_type = 'FOREIGN KEY';
