import { Helmet } from 'react-helmet-async'
import { Link } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { ArrowLeft } from 'lucide-react'

const faqs = [
  { q: 'How does GPS check-in work?', a: 'When you tap "Check In" on the dashboard, the system records your GPS location. If you are within the school\'s allowed radius, check-in is accepted. Otherwise, it is flagged.' },
  { q: 'What if I forget to check out?', a: 'The system auto-checks you out at the end of the day. You can also manually undo a checkout within a short window.' },
  { q: 'How is my status determined?', a: 'Checked in before reporting time + grace period = Present. After grace period = Late. No check-in = Absent.' },
  { q: 'Can I edit my profile?', a: 'Teachers can update their phone number and other details from the dashboard profile card.' },
  { q: 'Who can see my attendance records?', a: 'You and school administrators. Your records are private to others.' },
  { q: 'How do I reset my password?', a: 'Click "Forgot Password" on the login page and follow the email instructions.' },
]

export default function HelpPage() {
  return (
    <>
      <Helmet>
        <title>Help — JK Attendance System</title>
        <meta name="description" content="Frequently asked questions about JK Attendance System" />
      </Helmet>
      <div className="mx-auto max-w-3xl space-y-6 px-4 py-8">
        <div className="flex items-center gap-4">
          <Link to="/"><Button variant="ghost" size="sm"><ArrowLeft className="mr-1 h-4 w-4" />Back</Button></Link>
          <h1 className="text-2xl font-bold">Help & FAQ</h1>
        </div>
        <div className="grid gap-4">
          {faqs.map((f, i) => (
            <Card key={i}>
              <CardHeader><CardTitle className="text-base">{f.q}</CardTitle></CardHeader>
              <CardContent><p className="text-sm text-muted-foreground">{f.a}</p></CardContent>
            </Card>
          ))}
        </div>
        <p className="text-center text-sm text-muted-foreground">
          Still need help? Contact your school administrator.
        </p>
      </div>
    </>
  )
}
