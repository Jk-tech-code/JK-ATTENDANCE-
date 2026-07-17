-- ============================================
-- JK Attendance - Migration 00008
-- Add GPS and device columns to attendance
-- ============================================

ALTER TABLE attendance
ADD COLUMN IF NOT EXISTS teacher_latitude DOUBLE PRECISION,
ADD COLUMN IF NOT EXISTS teacher_longitude DOUBLE PRECISION,
ADD COLUMN IF NOT EXISTS school_latitude DOUBLE PRECISION,
ADD COLUMN IF NOT EXISTS school_longitude DOUBLE PRECISION,
ADD COLUMN IF NOT EXISTS distance_from_school DOUBLE PRECISION,
ADD COLUMN IF NOT EXISTS location_status TEXT,
ADD COLUMN IF NOT EXISTS gps_accuracy DOUBLE PRECISION;
