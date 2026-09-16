# JK Attendance System — Attendance Policy A

## Overview

The JK Attendance System enforces **Policy A — Grace Period Is Classification Only**.

IMPORTANT — DO NOT CHANGE THIS BEHAVIOR:
The grace period is a classification threshold, NOT a hard check-in deadline. A teacher checking in after the grace period expires must still be allowed to create an attendance record successfully.

---

## Business Rationale

The institution requires an accurate operational record of actual teacher arrival times and tardiness. Rejecting late check-ins would force administrators to perform manual overrides or paper-based tracking, undermining auditability. 

Policy A ensures:
1. Actual arrival tracking for every teacher.
2. Accurate tardiness measurement (`late_minutes`).
3. Fewer administrative overrides.
4. Consistent server-side classification.
5. Fully auditable attendance history.

---

## Policy Mechanics

The authoritative calculation occurs server-side at the PostgreSQL RPC layer (e.g., `check_in_with_location` in `supabase/migrations/00057_fix_check_in_attendance_status.sql`).

### Calculation
```text
grace_end = reporting_start_time + grace_period_minutes
```

### Classification Rules
- **If `check_in_time <= grace_end`**:
  - `attendance_status = PRESENT`
  - `late_minutes = 0`
- **If `check_in_time > grace_end`**:
  - `attendance_status = LATE`
  - `late_minutes = check_in_time - grace_end`
  - Check-in **remains successful** (`success = true`).

---

## Example Scenario

- **Reporting time**: 06:40
- **Grace period**: 25 minutes
- **Grace ends**: 07:05

| Check-in Time | attendance_status | late_minutes | Check-in Result |
|---------------|-------------------|--------------|-----------------|
| 06:30         | PRESENT           | 0            | Accepted        |
| 06:40         | PRESENT           | 0            | Accepted        |
| 06:55         | PRESENT           | 0            | Accepted        |
| 07:05         | PRESENT           | 0            | Accepted        |
| 07:06         | LATE              | 1            | Accepted        |
| 07:10         | LATE              | 5            | Accepted        |
| 07:30         | LATE              | 25           | Accepted        |
| 08:00         | LATE              | 55           | Accepted        |
| 09:00         | LATE              | 115          | Accepted        |

Note: A check-in at 07:06 means `attendance_status = LATE` and `late_minutes = 1`. It is **NOT** rejected.

---

## Boundary Condition
The server-side check uses strict inequality:
```sql
IF v_now::TIME > v_grace_end THEN
  v_attendance_status := 'LATE';
  v_late_minutes := EXTRACT(EPOCH FROM (v_now::TIME - v_grace_end)) / 60;
ELSE
  v_attendance_status := 'PRESENT';
END IF;
```
- Exactly at `grace_end` (07:05) → `PRESENT`.
- One minute after `grace_end` (07:06) → `LATE`.
