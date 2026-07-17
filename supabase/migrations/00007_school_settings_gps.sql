-- ============================================
-- JK Attendance - Migration 00007
-- School Settings: GPS columns + seed Glorious Group of Schools
-- ============================================

ALTER TABLE school_settings
ADD COLUMN IF NOT EXISTS allowed_radius_meters INTEGER DEFAULT 100,
ADD COLUMN IF NOT EXISTS active BOOLEAN DEFAULT TRUE,
ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW();

UPDATE school_settings
SET allowed_radius_meters = allowed_radius
WHERE allowed_radius_meters IS NULL AND allowed_radius IS NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM school_settings LIMIT 1) THEN
    INSERT INTO school_settings (school_name, latitude, longitude, allowed_radius_meters, active)
    VALUES ('Glorious Group of Schools', -1.51, 36.95, 100, TRUE);
  ELSE
    UPDATE school_settings
    SET
      school_name = 'Glorious Group of Schools',
      latitude = -1.51,
      longitude = 36.95,
      allowed_radius_meters = 100,
      active = TRUE
    WHERE id = (SELECT id FROM school_settings LIMIT 1);
  END IF;
END $$;
