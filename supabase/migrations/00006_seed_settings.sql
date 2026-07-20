-- ============================================
-- Seed: School Settings
-- Update the coordinates to your actual school location
-- ============================================

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM school_settings LIMIT 1) THEN
    INSERT INTO school_settings (school_name, latitude, longitude, allowed_radius, default_reporting_time)
    VALUES ('JK School', -1.472988, 36.960895, 100, '07:20');
  END IF;
END $$;
