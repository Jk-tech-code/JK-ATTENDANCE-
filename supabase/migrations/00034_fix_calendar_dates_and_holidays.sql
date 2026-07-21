-- ============================================
-- JK Attendance - Migration 00034
-- Fix calendar dates + holidays table + RLS
-- ============================================

-- ============================================
-- 1. FIX get_month_calendar RPC
-- Root cause: sc.calendar_date from LEFT JOIN is NULL
-- when no school_calendar entry exists. The 'date'
-- field was NULL for most days, causing "?" in UI.
-- Fix: use d.calendar_date from generate_series,
-- cast to TEXT for absolute JSON safety.
-- ============================================
CREATE OR REPLACE FUNCTION get_month_calendar(
  p_year INTEGER,
  p_month INTEGER
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

  WITH calendar_entries AS (
    SELECT
      d.calendar_date::TEXT AS date_str,
      COALESCE(sc.day_type,
        CASE WHEN EXTRACT(DOW FROM d.calendar_date) IN (0, 6) THEN 'weekend' ELSE 'working_day' END
      ) AS day_type,
      COALESCE(sc.title,
        CASE
          WHEN EXTRACT(DOW FROM d.calendar_date) = 0 THEN 'Sunday'
          WHEN EXTRACT(DOW FROM d.calendar_date) = 6 THEN 'Saturday'
          ELSE 'Working Day'
        END
      ) AS title,
      sc.description,
      h.title AS holiday_title,
      h.type AS holiday_type
    FROM generate_series(v_start_date, v_end_date, '1 day') AS d(calendar_date)
    LEFT JOIN school_calendar sc ON sc.calendar_date = d.calendar_date
    LEFT JOIN holidays h ON h.holiday_date = d.calendar_date
  ),
  attendance_summary AS (
    SELECT
      a.attendance_date,
      COUNT(*) FILTER (WHERE a.status IN ('present', 'checked_out')) AS present_count,
      COUNT(*) FILTER (WHERE a.status = 'late') AS late_count,
      COUNT(*) FILTER (WHERE a.status = 'absent') AS absent_count,
      COUNT(*) AS total_count
    FROM attendance a
    WHERE a.attendance_date BETWEEN v_start_date AND v_end_date
    GROUP BY a.attendance_date
  )
  SELECT jsonb_build_object(
    'year', p_year,
    'month', p_month,
    'total_days', EXTRACT(DAY FROM v_end_date),
    'calendar', COALESCE(
      (SELECT jsonb_agg(
        jsonb_build_object(
          'date', ce.date_str,
          'day_type', ce.day_type,
          'title', COALESCE(ce.holiday_title, ce.title),
          'description', ce.description,
          'present', COALESCE(as2.present_count, 0),
          'late', COALESCE(as2.late_count, 0),
          'absent', COALESCE(as2.absent_count, 0),
          'total', COALESCE(as2.total_count, 0)
        )
        ORDER BY ce.date_str
      )
      FROM calendar_entries ce
      LEFT JOIN attendance_summary as2 ON as2.attendance_date = ce.date_str::DATE),
      '[]'::jsonb
    )
  ) INTO v_result;

  RETURN v_result;
END;
$$;

-- ============================================
-- 2. CREATE holidays TABLE
-- ============================================
CREATE TABLE IF NOT EXISTS holidays (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  description TEXT,
  holiday_date DATE NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('holiday', 'event')),
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(holiday_date, type)
);

ALTER TABLE holidays ENABLE ROW LEVEL SECURITY;

-- ============================================
-- 3. RLS POLICIES FOR holidays TABLE
-- ============================================
DROP POLICY IF EXISTS "Anyone can read holidays" ON holidays;
CREATE POLICY "Anyone can read holidays"
  ON holidays FOR SELECT
  TO authenticated
  USING (true);

DROP POLICY IF EXISTS "Admins insert holidays" ON holidays;
CREATE POLICY "Admins insert holidays"
  ON holidays FOR INSERT
  TO authenticated
  WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "Admins update holidays" ON holidays;
CREATE POLICY "Admins update holidays"
  ON holidays FOR UPDATE
  TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "Admins delete holidays" ON holidays;
CREATE POLICY "Admins delete holidays"
  ON holidays FOR DELETE
  TO authenticated
  USING (public.is_admin());

-- ============================================
-- 4. SEED holidays FROM school_calendar
-- ============================================
INSERT INTO holidays (title, description, holiday_date, type)
SELECT
  COALESCE(title, day_type),
  description,
  calendar_date,
  day_type
FROM school_calendar
WHERE day_type IN ('holiday', 'event')
  AND (title IS NOT NULL OR description IS NOT NULL)
ON CONFLICT (holiday_date, type) DO NOTHING;

-- ============================================
-- 5. INDEXES
-- ============================================
CREATE INDEX IF NOT EXISTS idx_holidays_date ON holidays(holiday_date);
CREATE INDEX IF NOT EXISTS idx_holidays_type ON holidays(type);

-- ============================================
-- 6. VERIFY
-- ============================================
DO $$
DECLARE
  cal_count INT;
  holiday_count INT;
  cal_test JSONB;
  first_date TEXT;
BEGIN
  SELECT COUNT(*) INTO cal_count FROM holidays;
  RAISE NOTICE 'Holidays seeded: %', cal_count;

  SELECT get_month_calendar(2026, 7) INTO cal_test;
  SELECT cal_test->'calendar'->0->>'date' INTO first_date;
  RAISE NOTICE 'First date of July 2026 calendar: %', first_date;
  IF first_date IS NULL OR length(first_date) != 10 THEN
    RAISE EXCEPTION 'CALENDAR BUG: first date is null or wrong length!';
  END IF;
END;
$$;
