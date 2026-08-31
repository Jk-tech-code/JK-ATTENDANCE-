# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**JK Attendance System** — GPS-based attendance tracking for Glorious Group of Schools.

- **Frontend:** React 19 + TypeScript + Vite + Tailwind CSS v4 + shadcn/ui
- **Backend:** Supabase (Auth, Database, Edge Functions in Deno)
- **Charts:** Recharts
- **Export:** jsPDF, xlsx
- **PWA:** vite-plugin-pwa (offline support)
- **Deployment:** Netlify / Vercel

## Key Commands

```bash
# Development
npm run dev              # Start Vite dev server

# Build & Type-check
npm run build            # tsc -b && vite build
npm run lint             # oxlint

# Testing
npm run test             # vitest run (all tests)
npm run test:watch       # vitest (watch mode)

# Preview production build
npm run preview
```

### Single Test File
```bash
npx vitest run src/services/attendance.test.ts
```

## Architecture

### Frontend Structure (`src/`)
- **`main.tsx`** — App entry: providers (Auth, Theme, Notification, Realtime, QueryClient, Helmet, ErrorBoundary, Sentry)
- **`App.tsx`** — Routing with lazy-loaded pages, route guards (`ProtectedRoute`, `AdminRoute`, `PublicRoute`)
- **`contexts/`** — React contexts: `AuthContext`, `ThemeContext`, `NotificationContext`, `RealtimeContext`
- **`hooks/`** — Custom hooks for data fetching: `useAuth`, `useAttendance`, `useAdminDashboard`, `useReports`, `useTeachers`, `useCalendar`, `useSchoolSettings`, `useLocationAttendance`, etc.
- **`services/`** — Supabase client (`supabase.ts`), API wrappers: `auth.ts`, `attendance.ts`, `admin.ts`, `calendar.ts`, `location.ts`, `attendanceApi.ts`
- **`pages/`** — Route pages: `DashboardPage`, `LoginPage`, `LandingPage`, plus `/admin/*` pages
- **`layouts/`** — Layout components: `DashboardLayout`, `AdminLayout`, `AuthLayout`
- **`components/`** — UI components (shadcn-based), charts, modals, dashboard widgets
- **`lib/`** — Utilities: `format.ts`, `device.ts`, `utils.ts`, `errors.ts`, `calendarDate.test.ts`

### Backend (Supabase)

#### Database Migrations (`supabase/migrations/`)
36+ migrations evolving schema:
- Core: `teachers`, `attendance`, `school_settings`, `school_holidays`, `profiles`
- GPS columns, check-in/out RPCs, RLS policies, audit logs, rate limiting, invite system

#### Edge Functions (`supabase/functions/`)
| Function | Purpose |
|----------|---------|
| `record-attendance` | Server-side attendance recording |
| `attendance-validator` | Business logic: late/early/complete status |
| `check_in_with_location` | **Core RPC** — Haversine GPS validation in Postgres |
| `process-end-of-day` | Cron: auto-check-out absent teachers |
| `attendance-ai-analysis` | Monthly AI insights (OpenAI/DeepSeek) |
| `calendar-check` | Holiday/weekend validation |
| `invite-teacher` / `delete-teacher` | Teacher lifecycle |
| `verify-admin` | Admin JWT verification |
| `attendance-notification` | Real-time notifications |
| `cron-report` / `daily-report` / `monthly-report` | Scheduled reports |

#### Key RPC: `check_in_with_location`
Server-side GPS geofencing using Haversine formula. Validates:
- GPS accuracy ≤ 50m
- Distance from school ≤ `allowed_radius_meters`
- Auto-calculates `late_minutes` based on `reporting_time`
- Returns `location_status`: `inside_school` / `outside_school` / `low_accuracy`

### Authentication & Roles
- **Supabase Auth** with email/password + Google OAuth
- **Roles:** `admin` (via `user_metadata.role` JWT claim) / `teacher`
- **RLS policies** enforce: teachers see only their data; admins see all
- **Admin login:** `kipkemoijared855@gmail.com`

## Environment Variables

### Required (Frontend)
```env
VITE_SUPABASE_URL=...
VITE_SUPABASE_ANON_KEY=...
```

### Optional (Frontend)
```env
VITE_SENTRY_DSN=...
VITE_SITE_URL=...
```

### Supabase Edge Function Secrets
```bash
supabase secrets set OPENAI_API_KEY=sk-...
supabase secrets set DEEPSEEK_API_KEY=sk-...
supabase secrets set CRON_SECRET=...  # for process-end-of-day auth
```

## Cron Job (End-of-Day Processing)
Trigger daily at closing time via external cron (cron-job.org, etc.):
```
POST https://ireyodsiyvvjfqymgdpa.supabase.co/functions/v1/process-end-of-day
Header: x-api-key: <CRON_SECRET>
```

## Testing

- **Framework:** Vitest + jsdom + @testing-library/react
- **Setup:** `src/test/setup.ts` (minimal — just jest-dom)
- **Test files:** Co-located `*.test.ts(x)` (e.g., `attendance.test.ts`, `format.test.ts`, `auth.test.ts`)
- Run all: `npm run test`
- Watch: `npm run test:watch`

## Key Implementation Patterns

### Data Fetching
- TanStack Query (React Query) with `staleTime: 30_000`, `retry: 1`
- Custom hooks wrap queries (`useAttendance`, `useAdminDashboard`, etc.)
- Server-side logic in Edge Functions / Postgres RPCs, not client

### GPS/Location
- Browser Geolocation API → `check_in_with_location` RPC
- All validation server-side (cannot be spoofed)
- Accuracy threshold: 50m

### Error Handling
- Custom error classes in `src/lib/errors.ts` (`AlreadyCheckedInError`, `NoAttendanceRecordError`, etc.)
- Thrown from service layer, caught in hooks/components, shown via `sonner` toasts

### Real-time
- `RealtimeContext` subscribes to `attendance` table changes
- Triggers refetch in `useAttendanceRecords`, `useAdminDashboard`

## Common Development Tasks

### Add a new Edge Function
1. Create `supabase/functions/<name>/index.ts`
2. Add Deno config if needed (`deno.json`)
3. Deploy: `supabase functions deploy <name>`
4. Set secrets: `supabase secrets set KEY=value`

### Modify Database Schema
1. Create migration: `supabase migration new <name>`
2. Edit `supabase/migrations/<timestamp>_<name>.sql`
3. Apply locally: `supabase db reset`
4. Push to remote: `supabase db push`

### Add a New Admin Page
1. Create `src/pages/admin/NewPage.tsx`
2. Add lazy import + route in `App.tsx` under `AdminRoute`
3. Add to `AdminLayout` sidebar if needed

## Troubleshooting

- **Supabase connection fails** → check `.env` has `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`
- **GPS check-in rejected** → verify `school_settings` has active row with correct lat/lon/radius
- **RLS blocks query** → check JWT `user_metadata.role` claim; admin must have `role: "admin"`
- **Edge function 401** → verify `Authorization: Bearer <anon_key>` header from client, or `x-api-key` for cron
- **Build fails on types** → run `npm run build` to see `tsc -b` errors