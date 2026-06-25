const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

export interface HoursGridProps {
  hours: Record<string, string>
  todayIndex?: number
}

export function HoursGrid({ hours, todayIndex = new Date().getDay() }: HoursGridProps) {
  const todayName = DAY_NAMES[todayIndex]
  return (
    <table className="w-auto text-sm">
      <tbody>
        {DAY_NAMES.map((day) => {
          const time = hours[day] ?? 'Closed'
          const isToday = day === todayName
          const isClosed = time.toLowerCase() === 'closed'
          return (
            <tr key={day} className={isToday ? 'font-bold text-fc-text-primary' : 'text-fc-text-secondary'}>
              <th scope="row" className="pr-4 text-left font-normal">
                {day}
              </th>
              <td className={isClosed ? 'text-fc-text-muted' : 'text-fc-text-primary'}>
                {isToday ? <span className="sr-only">Today: </span> : null}
                {time}
              </td>
            </tr>
          )
        })}
      </tbody>
    </table>
  )
}
