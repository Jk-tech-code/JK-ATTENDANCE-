import { Link } from 'react-router-dom'
import { Helmet } from 'react-helmet-async'
import { Button } from '@/components/ui/button'
import { MapPin, ClipboardCheck, BarChart, Shield } from 'lucide-react'

export default function LandingPage() {
  return (
    <>
      <Helmet>
        <title>JK Attendance System — GPS-Based Teacher Attendance Tracking</title>
        <meta name="description" content="GPS-based attendance tracking system for schools. Real-time check-in/out, geofencing, AI-powered reports, and admin dashboard." />
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
