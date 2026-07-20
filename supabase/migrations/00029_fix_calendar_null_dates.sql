-- ============================================
-- JK Attendance - Migration 00029
-- Fix NaN dates in calendar page
-- Root cause: get_month_calendar used sc.calendar_date
-- from a LEFT JOIN, which is NULL for dates without
-- a school_calendar entry. Changed to d.calendar_date
-- from generate_series, which is never NULL.
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
      d.calendar_date,  -- use generate_series date, NOT sc.calendar_date (NULL when no match)
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
