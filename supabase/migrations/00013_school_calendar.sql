-- ============================================
-- JK Attendance - Migration 00013
-- School Calendar module
-- ============================================

-- ============================================
-- 1. SCHOOL CALENDAR TABLE
-- ============================================
CREATE TABLE IF NOT EXISTS school_calendar (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  calendar_date DATE NOT NULL UNIQUE,
  day_type TEXT NOT NULL CHECK (day_type IN ('working_day', 'weekend', 'holiday', 'event')),
  title TEXT,
  description TEXT,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE school_calendar ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Everyone read school_calendar') THEN
    CREATE POLICY "Everyone read school_calendar"
      ON school_calendar FOR SELECT TO authenticated
      USING (true);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Admins insert school_calendar') THEN
    CREATE POLICY "Admins insert school_calendar"
      ON school_calendar FOR INSERT TO authenticated
      WITH CHECK (
        EXISTS (SELECT 1 FROM auth.users WHERE id = auth.uid() AND raw_user_meta_data->>'role' = 'admin')
      );
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Admins update school_calendar') THEN
    CREATE POLICY "Admins update school_calendar"
      ON school_calendar FOR UPDATE TO authenticated
      USING (
        EXISTS (SELECT 1 FROM auth.users WHERE id = auth.uid() AND raw_user_meta_data->>'role' = 'admin')
      );
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Admins delete school_calendar') THEN
    CREATE POLICY "Admins delete school_calendar"
      ON school_calendar FOR DELETE TO authenticated
      USING (
        EXISTS (SELECT 1 FROM auth.users WHERE id = auth.uid() AND raw_user_meta_data->>'role' = 'admin')
      );
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_school_calendar_date ON school_calendar(calendar_date);
CREATE INDEX IF NOT EXISTS idx_school_calendar_day_type ON school_calendar(day_type);

-- ============================================
-- 2. FUNCTION: auto_populate_weekends()
-- Marks all Saturdays/Sundays as weekend in school_calendar
-- for a given year range. Idempotent (upsert).
-- ============================================
CREATE OR REPLACE FUNCTION auto_populate_weekends(
  p_start_year INTEGER DEFAULT EXTRACT(YEAR FROM CURRENT_DATE),
  p_end_year INTEGER DEFAULT EXTRACT(YEAR FROM CURRENT_DATE) + 1
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_date DATE;
  v_dow INTEGER;
  v_count INTEGER := 0;
BEGIN
  v_date := make_date(p_start_year, 1, 1);

  WHILE v_date <= make_date(p_end_year, 12, 31) LOOP
    v_dow := EXTRACT(DOW FROM v_date);

    IF v_dow IN (0, 6) THEN
      INSERT INTO school_calendar (calendar_date, day_type, title)
      VALUES (
        v_date,
        'weekend',
        CASE v_dow WHEN 0 THEN 'Sunday' ELSE 'Saturday' END
      )
      ON CONFLICT (calendar_date)
      DO UPDATE SET day_type = 'weekend',
                    title = CASE v_dow WHEN 0 THEN 'Sunday' ELSE 'Saturday' END
      WHERE school_calendar.day_type != 'holiday' AND school_calendar.day_type != 'event';

      v_count := v_count + 1;
    END IF;

    v_date := v_date + INTERVAL '1 day';
  END LOOP;

  RETURN v_count;
END;
$$;

-- ============================================
-- 3. FUNCTION: check_calendar_date(p_date)
-- Returns whether attendance is allowed on a given date.
-- ============================================
CREATE OR REPLACE FUNCTION check_calendar_date(p_date DATE DEFAULT CURRENT_DATE)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_record RECORD;
  v_dow INTEGER;
  v_is_weekend BOOLEAN := FALSE;
  v_is_holiday BOOLEAN := FALSE;
  v_day_type TEXT;
  v_title TEXT;
BEGIN
  SELECT * INTO v_record
  FROM school_calendar
  WHERE calendar_date = p_date;

  v_dow := EXTRACT(DOW FROM p_date);
  v_is_weekend := v_dow IN (0, 6);

  IF FOUND THEN
    v_day_type := v_record.day_type;
    v_title := v_record.title;
    v_is_holiday := v_record.day_type IN ('holiday', 'event');
  ELSE
    IF v_is_weekend THEN
      v_day_type := 'weekend';
      v_title := CASE v_dow WHEN 0 THEN 'Sunday' ELSE 'Saturday' END;
    ELSE
      v_day_type := 'working_day';
      v_title := 'Working Day';
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'date', p_date,
    'day_type', v_day_type,
    'title', v_title,
    'is_weekend', v_is_weekend,
    'is_holiday', v_is_holiday,
    'attendance_allowed', v_day_type = 'working_day'
  );
END;
$$;

-- ============================================
-- 4. FUNCTION: get_month_calendar(p_year, p_month)
-- Returns all calendar entries + attendance summary for a month.
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
      sc.calendar_date,
      COALESCE(sc.day_type,
        CASE WHEN EXTRACT(DOW FROM sc.calendar_date) IN (0, 6) THEN 'weekend' ELSE 'working_day' END
      ) AS day_type,
      COALESCE(sc.title,
        CASE
          WHEN EXTRACT(DOW FROM sc.calendar_date) = 0 THEN 'Sunday'
          WHEN EXTRACT(DOW FROM sc.calendar_date) = 6 THEN 'Saturday'
          ELSE 'Working Day'
        END
      ) AS title,
      sc.description
    FROM generate_series(v_start_date, v_end_date, '1 day') AS d(calendar_date)
    LEFT JOIN school_calendar sc ON sc.calendar_date = d.calendar_date
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
          'date', ce.calendar_date,
          'day_type', ce.day_type,
          'title', ce.title,
          'description', ce.description,
          'present', COALESCE(as2.present_count, 0),
          'late', COALESCE(as2.late_count, 0),
          'absent', COALESCE(as2.absent_count, 0),
          'total', COALESCE(as2.total_count, 0)
        )
        ORDER BY ce.calendar_date
      )
      FROM calendar_entries ce
      LEFT JOIN attendance_summary as2 ON as2.attendance_date = ce.calendar_date),
      '[]'::jsonb
    )
  ) INTO v_result;

  RETURN v_result;
END;
$$;

-- ============================================
-- 5. AUTO-POPULATE weekends for current + next year
-- ============================================
SELECT auto_populate_weekends(
  EXTRACT(YEAR FROM CURRENT_DATE)::INTEGER,
  EXTRACT(YEAR FROM CURRENT_DATE)::INTEGER + 1
);
