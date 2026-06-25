const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

export interface OpenStatus {
  isOpen: boolean
  statusText: string
  nextStatusText?: string
}

export function computeOpenStatus(
  hours: Record<string, string>,
  timezone: string,
  now = new Date()
): OpenStatus {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    weekday: 'long',
    hour: 'numeric',
    minute: 'numeric',
    hour12: true,
  })
  const parts = formatter.formatToParts(now)
  const weekday = parts.find((p) => p.type === 'weekday')?.value ?? DAY_NAMES[now.getDay()]
  const hourMinute =
    parts.find((p) => p.type === 'hour')?.value +
    ':' +
    parts.find((p) => p.type === 'minute')?.value +
    ' ' +
    parts.find((p) => p.type === 'dayPeriod')?.value

  const todayHours = hours[weekday] ?? 'Closed'
  if (todayHours.toLowerCase() === 'closed') {
    const nextOpen = findNextOpen(hours, weekday)
    return {
      isOpen: false,
      statusText: 'Closed',
      nextStatusText: nextOpen ? `Opens ${nextOpen}` : undefined,
    }
  }

  const [openRaw, closeRaw] = todayHours.split('–').map((s) => s.trim())
  const openMinutes = parseTime(openRaw)
  const closeMinutes = parseTime(closeRaw)
  const currentMinutes = parseTime(hourMinute)

  if (openMinutes == null || closeMinutes == null || currentMinutes == null) {
    return { isOpen: false, statusText: 'Closed' }
  }

  const isOpen = currentMinutes >= openMinutes && currentMinutes < closeMinutes
  if (isOpen) {
    return {
      isOpen: true,
      statusText: 'Open now',
      nextStatusText: `Closes at ${closeRaw}`,
    }
  }

  const nextOpen = currentMinutes < openMinutes ? `today at ${openRaw}` : findNextOpen(hours, weekday)
  return {
    isOpen: false,
    statusText: 'Closed',
    nextStatusText: nextOpen ? `Opens ${nextOpen}` : undefined,
  }
}

function parseTime(time: string): number | null {
  const match = time.match(/(\d+):(\d+)\s*(AM|PM)/i)
  if (!match) return null
  let hours = parseInt(match[1], 10)
  const minutes = parseInt(match[2], 10)
  const period = match[3].toUpperCase()
  if (period === 'PM' && hours !== 12) hours += 12
  if (period === 'AM' && hours === 12) hours = 0
  return hours * 60 + minutes
}

function findNextOpen(hours: Record<string, string>, fromDay: string): string | null {
  const idx = DAY_NAMES.indexOf(fromDay)
  for (let i = 1; i <= 7; i++) {
    const day = DAY_NAMES[(idx + i) % 7]
    const value = hours[day]
    if (value && value.toLowerCase() !== 'closed') {
      const open = value.split('–')[0].trim()
      return `${day} at ${open}`
    }
  }
  return null
}
