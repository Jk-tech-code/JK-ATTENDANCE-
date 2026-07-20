import { Link } from 'react-router-dom'
import { Helmet } from 'react-helmet-async'
import { Button } from '@/components/ui/button'
import { MapPin, ClipboardCheck, BarChart, Shield } from 'lucide-react'

const siteUrl = typeof window !== 'undefined' ? window.location.origin : 'https://jkattendance.vercel.app'

export default function LandingPage() {
  return (
    <>
      <Helmet>
        <title>JK Attendance System — School Attendance Management</title>
        <meta name="description" content="Modern school attendance management platform for teacher attendance tracking, reporting, analytics, and school administration." />
        <link rel="canonical" href={`${siteUrl}/`} />
        <meta property="og:title" content="JK Attendance System — School Attendance Management" />
        <meta property="og:description" content="Modern school attendance management platform for teacher attendance tracking, reporting, analytics, and school administration." />
        <meta property="og:url" content={`${siteUrl}/`} />
        <meta property="og:image" content={`${siteUrl}/1_full_color_version.png`} />
        <meta property="og:image:width" content="1200" />
        <meta property="og:image:height" content="630" />
        <meta property="og:locale" content="en_US" />
        <meta property="og:site_name" content="JK Attendance System" />
        <meta property="og:type" content="website" />
        <meta name="twitter:card" content="summary_large_image" />
        <meta name="twitter:title" content="JK Attendance System — School Attendance Management" />
        <meta name="twitter:description" content="Modern school attendance management platform for teacher attendance tracking, reporting, analytics, and school administration." />
        <meta name="twitter:image" content={`${siteUrl}/1_full_color_version.png`} />
        <script type="application/ld+json">
          {JSON.stringify({
            "@context": "https://schema.org",
            "@type": "Organization",
            "name": "Glorious Group of Schools",
            "url": siteUrl,
            "logo": `${siteUrl}/1_full_color_version.png`,
            "description": "JK Attendance System — GPS-based teacher attendance tracking for Glorious Group of Schools",
            "foundingDate": "2025",
            "knowsAbout": ["School Management", "Attendance Tracking", "GPS Geofencing"],
          })}
        </script>
      </Helmet>
      <div className="flex min-h-screen flex-col">
        <header className="border-b">
          <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4">
            <span className="text-lg font-bold">JK Attendance</span>
            <nav className="flex gap-4">
              <Link to="/login"><Button variant="ghost">Sign In</Button></Link>
              <Link to="/help"><Button variant="outline">Help</Button></Link>
            </nav>
          </div>
        </header>

        <main className="flex-1">
          <section className="mx-auto max-w-6xl px-4 py-20 text-center">
            <h1 className="text-4xl font-bold tracking-tight sm:text-5xl">GPS Attendance Tracking for Schools</h1>
            <p className="mx-auto mt-4 max-w-2xl text-lg text-muted-foreground">
              Track teacher check-in/out with GPS geofencing, generate reports, and get AI-powered attendance insights — all in one place.
            </p>
            <div className="mt-8 flex justify-center gap-4">
              <Link to="/login"><Button size="lg">Get Started</Button></Link>
              <Link to="/help"><Button variant="outline" size="lg">Learn More</Button></Link>
            </div>
          </section>

          <section className="mx-auto max-w-6xl px-4 py-16">
            <div className="grid gap-8 sm:grid-cols-2 lg:grid-cols-4">
              {[
                { icon: MapPin, title: 'GPS Geofencing', desc: 'Teachers check in only within school radius' },
                { icon: ClipboardCheck, title: 'Auto Status', desc: 'Present, late, or absent — determined automatically' },
                { icon: BarChart, title: 'AI Reports', desc: 'Monthly analytics with AI-powered recommendations' },
                { icon: Shield, title: 'Admin Control', desc: 'Manage teachers, settings, and view all records' },
              ].map((f) => (
                <div key={f.title} className="rounded-lg border p-6 text-center">
                  <f.icon className="mx-auto h-8 w-8 text-primary" />
                  <h3 className="mt-4 font-semibold">{f.title}</h3>
                  <p className="mt-2 text-sm text-muted-foreground">{f.desc}</p>
                </div>
              ))}
            </div>
          </section>
        </main>

        <footer className="border-t py-6 text-center text-sm text-muted-foreground">
          &copy; {new Date().getFullYear()} JK Attendance System. All rights reserved.
        </footer>
      </div>
    </>
  )
}
