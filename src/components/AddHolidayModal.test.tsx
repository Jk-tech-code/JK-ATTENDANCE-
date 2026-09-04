import { describe, it, expect, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AddHolidayModal } from '@/components/AddHolidayModal'

function renderModal(props: Partial<React.ComponentProps<typeof AddHolidayModal>> = {}) {
  const onSubmit = vi.fn().mockResolvedValue(undefined)
  const onOpenChange = vi.fn()
  const utils = render(
    <AddHolidayModal
      open={true}
      onOpenChange={onOpenChange}
      defaultType="holiday"
      defaultDate="2026-12-12"
      defaultTitle=""
      editMode={false}
      onSubmit={onSubmit}
      {...props}
    />,
  )
  return { onSubmit, onOpenChange, ...utils }
}

describe('AddHolidayModal — submit button enabled state', () => {
  it('renders the submit button enabled when all required fields are populated by default', () => {
    renderModal({ defaultDate: '2026-12-12', defaultTitle: 'National Day' })

    const button = screen.getByTestId('submit-holiday')
    expect(button).toBeInTheDocument()
    expect(button).not.toBeDisabled()
  })

  it('renders the submit button enabled even with empty defaults (button is not gated on isValid)', () => {
    renderModal({ defaultDate: '', defaultTitle: '' })
    const button = screen.getByTestId('submit-holiday')
    expect(button).not.toBeDisabled()
  })

  it('label is "Create Holiday" when day_type is holiday', () => {
    renderModal({ defaultType: 'holiday' })
    expect(screen.getByTestId('submit-holiday')).toHaveTextContent(/create holiday/i)
  })

  it('label is "Create Event" when day_type is event', () => {
    renderModal({ defaultType: 'event' })
    expect(screen.getByTestId('submit-holiday')).toHaveTextContent(/create event/i)
  })

  it('label is "Update Entry" in edit mode', () => {
    renderModal({ editMode: true })
    expect(screen.getByTestId('submit-holiday')).toHaveTextContent(/update entry/i)
  })
})

describe('AddHolidayModal — successful submission with valid data', () => {
  it('submits when all required fields are valid and the button is clicked', async () => {
    const user = userEvent.setup()
    const { onSubmit } = renderModal({
      defaultDate: '2026-12-12',
      defaultTitle: 'National Day',
      defaultType: 'holiday',
    })

    const dateInput = screen.getByLabelText(/date/i) as HTMLInputElement
    const titleInput = screen.getByLabelText(/title/i) as HTMLInputElement

    expect(dateInput.value).toBe('2026-12-12')
    expect(titleInput.value).toBe('National Day')

    const button = screen.getByTestId('submit-holiday')
    expect(button).not.toBeDisabled()

    await user.click(button)

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledTimes(1)
    })

    const submittedData = onSubmit.mock.calls[0][0]
    expect(submittedData.calendar_date).toBe('2026-12-12')
    expect(submittedData.day_type).toBe('holiday')
    expect(submittedData.title).toBe('National Day')
  })

  it('trims whitespace from title before submitting', async () => {
    const user = userEvent.setup()
    const { onSubmit } = renderModal({
      defaultDate: '2026-12-12',
      defaultTitle: '  Padded Title  ',
    })

    const titleInput = screen.getByLabelText(/title/i) as HTMLInputElement
    await user.clear(titleInput)
    await user.type(titleInput, '  Trimmed Title  ')

    await user.click(screen.getByTestId('submit-holiday'))

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalled()
    })
    expect(onSubmit.mock.calls[0][0].title).toBe('Trimmed Title')
  })

  it('sends undefined for empty description', async () => {
    const user = userEvent.setup()
    const { onSubmit } = renderModal({
      defaultDate: '2026-12-12',
      defaultTitle: 'No Description',
    })

    await user.click(screen.getByTestId('submit-holiday'))

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalled()
    })
    expect(onSubmit.mock.calls[0][0].description).toBeUndefined()
  })
})

describe('AddHolidayModal — validation errors are visible', () => {
  it('shows a visible error and does not call onSubmit when title is empty', async () => {
    const user = userEvent.setup()
    const { onSubmit } = renderModal({ defaultDate: '2026-12-12', defaultTitle: '' })

    const titleInput = screen.getByLabelText(/title/i) as HTMLInputElement
    expect(titleInput.value).toBe('')

    await user.click(screen.getByTestId('submit-holiday'))

    expect(onSubmit).not.toHaveBeenCalled()
    expect(await screen.findByText('Title is required', { selector: 'p' })).toBeInTheDocument()
  })

  it('shows a visible error when date is empty', async () => {
    const user = userEvent.setup()
    const { onSubmit } = renderModal({ defaultDate: '', defaultTitle: 'Test' })

    const dateInput = screen.getByLabelText(/date/i) as HTMLInputElement
    expect(dateInput.value).toBe('')

    await user.click(screen.getByTestId('submit-holiday'))

    expect(onSubmit).not.toHaveBeenCalled()
    expect(await screen.findByText('Date is required', { selector: 'p' })).toBeInTheDocument()
  })

  it('shows a summary error banner when validation fails', async () => {
    const user = userEvent.setup()
    const { onSubmit } = renderModal({ defaultDate: '', defaultTitle: '' })

    await user.click(screen.getByTestId('submit-holiday'))

    expect(onSubmit).not.toHaveBeenCalled()
    const alertBanner = await screen.findByText('Date is required', { selector: 'div' })
    expect(alertBanner).toBeInTheDocument()
    expect(alertBanner).toHaveAttribute('role', 'alert')
  })

  it('clears the error on the date field once the user types a valid date', async () => {
    const user = userEvent.setup()
    renderModal({ defaultDate: '', defaultTitle: 'Test' })

    await user.click(screen.getByTestId('submit-holiday'))
    expect(await screen.findByText('Date is required', { selector: 'p' })).toBeInTheDocument()

    const dateInput = screen.getByLabelText(/date/i) as HTMLInputElement
    await user.type(dateInput, '2026-12-12')

    await waitFor(() => {
      expect(screen.queryByText('Date is required', { selector: 'p' })).not.toBeInTheDocument()
    })
  })
})
