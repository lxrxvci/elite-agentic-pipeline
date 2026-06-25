# HoursGrid

Compact readout of weekly hours used inside `LocationCard` and the admin hours editor preview.

## Usage

- Renders seven day rows in a two-column grid (day / time).
- Highlights the current day and dims closed days.

## Anatomy

```
Mon    10:00 AM – 9:00 PM
Tue    10:00 AM – 9:00 PM
Wed    Closed
...
```

## Tokens

| Element | Token | Default value |
|---|---|---|
| Columns | `component.hoursGrid.columns` | `2` |
| Row gap | `component.hoursGrid.rowGap` | `0.25rem` |
| Column gap | `component.hoursGrid.columnGap` | `1rem` |
| Day font | `component.hoursGrid.day.font` | `semantic.font.body-sm` |
| Day color | `component.hoursGrid.day.color` | `text-secondary` |
| Time font | `component.hoursGrid.time.font` | `semantic.font.body-sm` |
| Time color | `component.hoursGrid.time.color` | `text-primary` |
| Current day weight | `component.hoursGrid.currentDay.weight` | `bold` |
| Closed color | `component.hoursGrid.closed.color` | `text-muted` |

## Behavior

- "Closed" rows use muted color.
- Current day is bolded based on the tenant timezone.
- Admin editor uses the same grid but with editable inputs.

## Accessibility

- Use a `<dl>` or `<table>` with `<th scope="row">` so screen readers associate days with times.
- Current day is announced via `aria-label="Today: Monday, 10:00 AM – 9:00 PM"`.

## Reference implementation

```tsx
interface HoursGridProps {
  hours: { day: string; time: string }[]
  todayIndex?: number
}

export function HoursGrid({ hours, todayIndex = new Date().getDay() }: HoursGridProps) {
  const dayMap = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday']
  const todayName = dayMap[todayIndex]
  return (
    <table className="w-auto text-sm">
      <tbody>
        {hours.map((h) => {
          const isToday = h.day === todayName
          const isClosed = h.time.toLowerCase() === 'closed'
          return (
            <tr key={h.day} className={isToday ? 'font-bold text-neutral-950' : 'text-neutral-600'}>
              <th scope="row" className="pr-4 text-left font-normal">{h.day}</th>
              <td className={isClosed ? 'text-neutral-400' : ''}>
                {isToday ? <span className="sr-only">Today: </span> : null}
                {h.time}
              </td>
            </tr>
          )
        })}
      </tbody>
    </table>
  )
}
```

## Motion

- Rows fade in with a stagger of `50ms`.
