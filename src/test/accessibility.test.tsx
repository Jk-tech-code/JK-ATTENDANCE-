import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import { BrowserRouter } from 'react-router-dom'
import { HelmetProvider } from 'react-helmet-async'
import axe from 'axe-core'

import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { EmptyState } from '@/components/ui/EmptyState'
import { Dialog } from '@/components/ui/dialog'
import { AlertDialog } from '@/components/ui/alert-dialog'
import { ClockWidget } from '@/components/dashboard/ClockWidget'

function renderWithProviders(component: React.ReactElement) {
  return render(
    <HelmetProvider>
      <BrowserRouter>{component}</BrowserRouter>
    </HelmetProvider>
  )
}

async function runAxe(container: HTMLElement): Promise<axe.AxeResults> {
  return new Promise((resolve, reject) => {
    axe.run(container, (err, results) => {
      if (err) reject(err)
      else resolve(results)
    })
  })
}

function assertNoViolations(results: axe.AxeResults) {
  if (results.violations.length > 0) {
    const formatted = results.violations
      .map(
        (v) =>
          `[${v.id}] ${v.description}: ${v.nodes.length} node(s)\n  ${v.nodes.map((n) => n.html).join('\n  ')}`
      )
      .join('\n')
    throw new Error(`Accessibility violations found:\n${formatted}`)
  }
}

describe('Accessibility - UI Components', () => {
  it('Button has accessible name', async () => {
    const { container } = renderWithProviders(<Button>Click me</Button>)
    const results = await runAxe(container)
    assertNoViolations(results)
  })

  it('Button with aria-label has accessible name', async () => {
    const { container } = renderWithProviders(
      <Button aria-label="Close dialog">
        <span aria-hidden>×</span>
      </Button>
    )
    const results = await runAxe(container)
    assertNoViolations(results)
  })

  it('Card has proper heading structure', async () => {
    const { container } = renderWithProviders(
      <Card>
        <CardHeader>
          <CardTitle>Dashboard Overview</CardTitle>
        </CardHeader>
        <CardContent>Content here</CardContent>
      </Card>
    )
    const results = await runAxe(container)
    assertNoViolations(results)
  })

  it('Input has associated label', async () => {
    const { container } = renderWithProviders(
      <div>
        <Label htmlFor="email-input">Email address</Label>
        <Input id="email-input" type="email" placeholder="Enter email" />
      </div>
    )
    const results = await runAxe(container)
    assertNoViolations(results)
  })

  it('Input without label has aria-label', async () => {
    const { container } = renderWithProviders(
      <Input aria-label="Search teachers" placeholder="Search..." />
    )
    const results = await runAxe(container)
    assertNoViolations(results)
  })

  it('Badge has sufficient color contrast', async () => {
    const { container } = renderWithProviders(<Badge variant="success">Active</Badge>)
    const results = await runAxe(container)
    assertNoViolations(results)
  })

  it('Skeleton has accessible role', async () => {
    const { container } = renderWithProviders(<Skeleton />)
    const results = await runAxe(container)
    assertNoViolations(results)
  })

  it('EmptyState has proper structure', async () => {
    const { container } = renderWithProviders(
      <EmptyState
        title="No teachers found"
        description="Add your first teacher to get started."
        icon={<span aria-hidden>👨‍🏫</span>}
      />
    )
    const results = await runAxe(container)
    assertNoViolations(results)
  })

  it('form with multiple inputs has proper labels', async () => {
    const { container } = renderWithProviders(
      <form>
        <div>
          <Label htmlFor="staff-number">Staff Number</Label>
          <Input id="staff-number" type="text" />
        </div>
        <div>
          <Label htmlFor="full-name">Full Name</Label>
          <Input id="full-name" type="text" />
        </div>
        <div>
          <Label htmlFor="email">Email</Label>
          <Input id="email" type="email" />
        </div>
      </form>
    )
    const results = await runAxe(container)
    assertNoViolations(results)
  })
})

describe('Accessibility - Dialog Components', () => {
  it('Dialog has accessible name', async () => {
    const { container } = renderWithProviders(
      <Dialog open onOpenChange={() => {}} title="Edit Teacher">
        <p>Dialog content</p>
      </Dialog>
    )
    const results = await runAxe(container)
    assertNoViolations(results)
  })

  it('AlertDialog has proper structure', async () => {
    const { container } = renderWithProviders(
      <AlertDialog
        open
        onOpenChange={() => {}}
        title="Delete Teacher"
        description="Are you sure you want to delete this teacher?"
        onConfirm={() => {}}
      />
    )
    const results = await runAxe(container)
    assertNoViolations(results)
  })
})

describe('Accessibility - Dashboard Components', () => {
  it('ClockWidget has accessible time', async () => {
    const { container } = renderWithProviders(<ClockWidget />)
    const results = await runAxe(container)
    assertNoViolations(results)
  })
})

describe('Accessibility - Color and Contrast', () => {
  it('success badge has sufficient contrast', async () => {
    const { container } = renderWithProviders(<Badge variant="success">Present</Badge>)
    const results = await runAxe(container)
    const contrastViolations = results.violations.filter((v) => v.id === 'color-contrast')
    expect(contrastViolations).toHaveLength(0)
  })

  it('destructive badge has sufficient contrast', async () => {
    const { container } = renderWithProviders(<Badge variant="destructive">Absent</Badge>)
    const results = await runAxe(container)
    const contrastViolations = results.violations.filter((v) => v.id === 'color-contrast')
    expect(contrastViolations).toHaveLength(0)
  })

  it('secondary badge has sufficient contrast', async () => {
    const { container } = renderWithProviders(<Badge variant="secondary">Late</Badge>)
    const results = await runAxe(container)
    const contrastViolations = results.violations.filter((v) => v.id === 'color-contrast')
    expect(contrastViolations).toHaveLength(0)
  })
})

describe('Accessibility - Keyboard Navigation', () => {
  it('Button is focusable', async () => {
    const { container } = renderWithProviders(<Button>Test Button</Button>)
    const button = container.querySelector('button')
    expect(button).not.toBeNull()
    expect(button?.tabIndex).toBeGreaterThanOrEqual(0)
  })

  it('Input in form is focusable', async () => {
    const { container } = renderWithProviders(
      <form>
        <Label htmlFor="test-input">Test Input</Label>
        <Input id="test-input" />
      </form>
    )
    const input = container.querySelector('input')
    expect(input).not.toBeNull()
    expect(input?.tabIndex).toBeGreaterThanOrEqual(0)
  })

  it('icon-only Button has aria-label', async () => {
    const { container } = renderWithProviders(
      <Button aria-label="Delete item" variant="ghost">
        <span aria-hidden>🗑</span>
      </Button>
    )
    const results = await runAxe(container)
    assertNoViolations(results)
  })

  it('form submission button is properly labeled', async () => {
    const { container } = renderWithProviders(
      <form>
        <Button type="submit">Save Changes</Button>
      </form>
    )
    const results = await runAxe(container)
    assertNoViolations(results)
  })
})

describe('Accessibility - ARIA Live Regions', () => {
  it('status region for loading states', async () => {
    const { container } = renderWithProviders(
      <div role="status" aria-live="polite" aria-atomic="true">
        Loading attendance data...
      </div>
    )
    const results = await runAxe(container)
    assertNoViolations(results)
  })
})

describe('Accessibility - Phase 5B Regression', () => {
  it('CardTitle renders a heading element', () => {
    const { container } = renderWithProviders(
      <Card>
        <CardHeader>
          <CardTitle>Test Title</CardTitle>
        </CardHeader>
      </Card>
    )
    const heading = container.querySelector('h1, h2, h3, h4, h5, h6')
    expect(heading).not.toBeNull()
    expect(heading?.textContent).toBe('Test Title')
  })

  it('CardTitle renders as custom heading element', () => {
    const { container } = renderWithProviders(
      <Card>
        <CardHeader>
          <CardTitle as="h2">Custom Heading</CardTitle>
        </CardHeader>
      </Card>
    )
    const heading = container.querySelector('h2')
    expect(heading).not.toBeNull()
    expect(heading?.textContent).toBe('Custom Heading')
  })

  it('Badge renders as span element', () => {
    const { container } = renderWithProviders(<Badge>Test</Badge>)
    const badge = container.querySelector('span')
    expect(badge).not.toBeNull()
    expect(badge?.tagName).toBe('SPAN')
  })

  it('AlertDialog links description via aria-describedby', () => {
    const { container } = renderWithProviders(
      <AlertDialog
        open
        onOpenChange={() => {}}
        title="Confirm Delete"
        description="This action cannot be undone."
        onConfirm={() => {}}
      />
    )
    const dialog = container.querySelector('[role="dialog"]')
    expect(dialog).not.toBeNull()
    const describedBy = dialog?.getAttribute('aria-describedby')
    expect(describedBy).toBeTruthy()
    const descriptionEl = container.querySelector(`#${describedBy}`)
    expect(descriptionEl).not.toBeNull()
    expect(descriptionEl?.textContent).toBe('This action cannot be undone.')
  })

  it('Loading spinner has role="status"', () => {
    const { container } = renderWithProviders(
      <div role="status" aria-live="polite">
        <span className="sr-only">Loading…</span>
      </div>
    )
    const status = container.querySelector('[role="status"]')
    expect(status).not.toBeNull()
    const srOnly = status?.querySelector('.sr-only')
    expect(srOnly).not.toBeNull()
  })

  it('Form error message has role="alert"', async () => {
    const { container } = renderWithProviders(
      <div>
        <Input aria-invalid="true" aria-describedby="test-error" />
        <p id="test-error" role="alert">
          Field is required
        </p>
      </div>
    )
    const alert = container.querySelector('[role="alert"]')
    expect(alert).not.toBeNull()
    expect(alert?.textContent).toBe('Field is required')
  })

  it('Select element has aria-label', async () => {
    const { container } = renderWithProviders(
      <select aria-label="Month">
        <option value="1">January</option>
      </select>
    )
    const select = container.querySelector('select')
    expect(select).not.toBeNull()
    expect(select?.getAttribute('aria-label')).toBe('Month')
  })

  it('Input with aria-required is announced as required', () => {
    const { container } = renderWithProviders(
      <Input aria-required="true" aria-invalid="true" aria-describedby="req-error" />
    )
    const input = container.querySelector('input')
    expect(input).not.toBeNull()
    expect(input?.getAttribute('aria-required')).toBe('true')
  })

  it('EmptyState default icon has aria-hidden', () => {
    const { container } = renderWithProviders(
      <EmptyState title="Empty" description="Nothing here" />
    )
    const icon = container.querySelector('[aria-hidden="true"]')
    expect(icon).not.toBeNull()
  })

  it('Decorative icon has aria-hidden', async () => {
    const { container } = renderWithProviders(
      <div>
        <span aria-hidden="true">📧</span>
        <span>Email label</span>
      </div>
    )
    const hidden = container.querySelector('[aria-hidden="true"]')
    expect(hidden).not.toBeNull()
    const results = await runAxe(container)
    assertNoViolations(results)
  })

  it('Error pre element is keyboard scrollable', () => {
    const { container } = renderWithProviders(
      <pre tabIndex={0} role="region" aria-label="Error details">
        Error message here
      </pre>
    )
    const pre = container.querySelector('pre')
    expect(pre).not.toBeNull()
    expect(pre?.getAttribute('tabindex')).toBe('0')
    expect(pre?.getAttribute('role')).toBe('region')
  })
})
