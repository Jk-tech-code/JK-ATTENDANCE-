-- ============================================
-- JK Attendance - Migration 00035
-- Create profiles table for Google OAuth users
-- ============================================

-- ============================================
-- 1. PROFILES TABLE
-- Lightweight profile for OAuth-authenticated
-- users who don't have a teacher record.
-- ============================================
CREATE TABLE IF NOT EXISTS profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  full_name TEXT,
  avatar_url TEXT,
  role TEXT NOT NULL DEFAULT 'teacher',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================
-- 2. ROW LEVEL SECURITY
-- ============================================
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;

-- Users can read their own profile
CREATE POLICY "Users read own profile"
  ON profiles FOR SELECT
  TO authenticated
  USING (auth.uid() = id);

-- Users can update their own profile
CREATE POLICY "Users update own profile"
  ON profiles FOR UPDATE
  TO authenticated
  USING (auth.uid() = id)
  WITH CHECK (auth.uid() = id);

-- Admins can read all profiles (via existing is_admin function)
CREATE POLICY "Admins read all profiles"
  ON profiles FOR SELECT
  TO authenticated
  USING (public.is_admin());

-- ============================================
-- 3. AUTO-CREATE PROFILE ON USER SIGNUP
-- Trigger fires after INSERT on auth.users.
-- ============================================
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  INSERT INTO public.profiles (id, email, full_name, avatar_url)
  VALUES (
    NEW.id,
    COALESCE(NEW.email, ''),
    COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.raw_user_meta_data->>'name', NEW.email),
    NEW.raw_user_meta_data->>'avatar_url'
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;

-- Drop existing trigger if re-running migration
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_user();
