# JK Attendance System

GPS-based attendance tracking system for **Glorious Group of Schools**.

## Tech Stack

- **Frontend:** React 19, TypeScript, Tailwind CSS v4, shadcn/ui
- **Backend:** Supabase (Auth, Database, Edge Functions)
- **Charts:** Recharts
- **Export:** jsPDF, xlsx
- **PWA:** vite-plugin-pwa (offline support)
- **Deployment:** Netlify

## Features

- Teacher check-in/check-out with GPS geofencing
- Real-time attendance dashboard
- Admin panel with teacher management
- Monthly reports with AI-powered insights (OpenAI / DeepSeek)
- Calendar & holiday management
- Attendance export (CSV, Excel, PDF)
- Dark/light mode
- PWA (installable on mobile)

## Setup

```bash
npm install
npm run dev
```

### Environment Variables (Netlify)

| Variable | Description |
|----------|-------------|
| `VITE_SUPABASE_URL` | Supabase project URL |
| `VITE_SUPABASE_ANON_KEY` | Supabase anonymous key |

### Supabase Edge Function Secrets

```bash
supabase secrets set OPENAI_API_KEY=sk-...
supabase secrets set DEEPSEEK_API_KEY=sk-...
```

### Cron Job (End-of-Day Processing)

Trigger daily at closing time:

```
https://ireyodsiyvvjfqymgdpa.supabase.co/functions/v1/process-end-of-day
```

## Login

- **Admin:** kipkemoijared855@gmail.com
- **Teachers:** Created via admin panel → Invite Teacher

## Admin Panel

Accessible at `/admin` after logging in as admin.
