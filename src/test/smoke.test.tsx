import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { EmptyState } from '@/components/ui/EmptyState'

describe('EmptyState', () => {
  it('renders title and description', () => {
    render(<EmptyState title="No data" description="Nothing here yet" />)
    expect(screen.getByText('No data')).toBeInTheDocument()
    expect(screen.getByText('Nothing here yet')).toBeInTheDocument()
  })

  it('renders action button when provided', () => {
    render(<EmptyState title="Empty" description="Add something" action={{ label: 'Add', onClick: () => {} }} />)
    expect(screen.getByText('Add')).toBeInTheDocument()
  })
})
