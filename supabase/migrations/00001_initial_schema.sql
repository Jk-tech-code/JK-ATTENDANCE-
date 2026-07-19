-- ============================================
-- JK Attendance - Database Schema
-- ============================================

-- 1. TEACHERS TABLE
CREATE TABLE teachers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  staff_number TEXT NOT NULL UNIQUE,
  full_name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  department TEXT,
  phone TEXT,
  reporting_time TIME DEFAULT '07:20',
  employment_status TEXT DEFAULT 'active' CHECK (employment_status IN ('active', 'inactive', 'suspended')),
  created_at TIMESTAMPTZ DEFAULT now()
);

-- 2. ATTENDANCE TABLE
CREATE TABLE attendance (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  teacher_id UUID NOT NULL REFERENCES teachers(id) ON DELETE CASCADE,
  attendance_date DATE NOT NULL DEFAULT CURRENT_DATE,
  check_in TIMESTAMPTZ,
  check_out TIMESTAMPTZ,
  late_minutes INTEGER,
  working_minutes INTEGER,
  status TEXT CHECK (status IN ('present', 'late', 'absent', 'checked_out')),
  latitude DECIMAL(10, 8),
  longitude DECIMAL(11, 8),
  device TEXT,
  browser TEXT,
  ip_address TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(teacher_id, attendance_date)
);

-- 3. SCHOOL SETTINGS TABLE
CREATE TABLE school_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_name TEXT,
  latitude DECIMAL(10, 8),
  longitude DECIMAL(11, 8),
  allowed_radius INTEGER DEFAULT 100,
  default_reporting_time TIME DEFAULT '07:20'
);

-- ============================================
-- INDEXES
-- ============================================
CREATE INDEX idx_attendance_teacher_id ON attendance(teacher_id);
CREATE INDEX idx_attendance_date ON attendance(attendance_date);
CREATE INDEX idx_attendance_status ON attendance(status);
CREATE INDEX idx_teachers_email ON teachers(email);
CREATE INDEX idx_teachers_staff_number ON teachers(staff_number);

-- ============================================
-- ROW LEVEL SECURITY
-- ============================================
ALTER TABLE teachers ENABLE ROW LEVEL SECURITY;
ALTER TABLE attendance ENABLE ROW LEVEL SECURITY;
ALTER TABLE school_settings ENABLE ROW LEVEL SECURITY;

-- Teachers can read their own profile
CREATE POLICY "Teachers read own profile"
  ON teachers FOR SELECT
  TO authenticated
  USING (id = auth.uid());

-- Admins can read all teachers (using JWT claim check)
CREATE POLICY "Admins read all teachers"
  ON teachers FOR SELECT
  TO authenticated
  USING (auth.jwt() -> 'user_metadata' ->> 'role' = 'admin');

-- Teachers can insert/update their own attendance
CREATE POLICY "Teachers manage own attendance"
  ON attendance FOR ALL
  TO authenticated
  USING (teacher_id = auth.uid())
  WITH CHECK (teacher_id = auth.uid());

-- Admins can read all attendance
CREATE POLICY "Admins read all attendance"
  ON attendance FOR SELECT
  TO authenticated
  USING (auth.jwt() -> 'user_metadata' ->> 'role' = 'admin');

-- School settings are readable by all authenticated users
CREATE POLICY "Authenticated users read school settings"
  ON school_settings FOR SELECT
  TO authenticated
  USING (true);

-- ============================================
-- TRIGGER: AUTO-CREATE TEACHER PROFILE
-- ============================================
-- This trigger creates a teacher record when a new user signs up
-- via Supabase Auth, if the email matches an invited teacher.
-- For manual creation, insert directly into the teachers table.

-- ============================================
-- SEED DATA (Optional)
-- ============================================
-- INSERT INTO school_settings (school_name, latitude, longitude, allowed_radius, default_reporting_time)
-- VALUES ('JK School', 28.6139, 77.2090, 100, '07:20');

-- INSERT INTO teachers (staff_number, full_name, email, department, phone, reporting_time)
-- VALUES ('T001', 'John Doe', 'john@jkschool.com', 'Mathematics', '555-0100', '07:20');
