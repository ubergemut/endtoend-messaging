export const STAYS = [
  { id: 'tab', label: 'This tab' },
  { id: 'day', label: '1 day' },
  { id: 'week', label: '1 week' },
  { id: 'month', label: '1 month' },
  { id: 'forever', label: 'Forever' },
] as const

export type StayChoice = (typeof STAYS)[number]['id']

export type StayAccount = { id: string; handle: string; displayName: string }

type StayRecord = {
  choice: StayChoice
  token?: string
  account?: StayAccount
  until?: number | null
}

const DAY = 24 * 60 * 60 * 1000

const DURATION: Record<StayChoice, number | null> = {
  tab: null,
  day: DAY,
  week: 7 * DAY,
  month: 30 * DAY,
  forever: null,
}

export const DEFAULT_STAY: StayChoice = 'week'

function storageKey(seat: string) {
  return seat ? `endtoend-stay:${seat}` : 'endtoend-stay'
}

function isChoice(value: unknown): value is StayChoice {
  return STAYS.some((stay) => stay.id === value)
}

function readRecord(seat: string): StayRecord | null {
  try {
    const parsed = JSON.parse(localStorage.getItem(storageKey(seat)) || '') as StayRecord
    if (!isChoice(parsed.choice)) return null
    return parsed
  } catch {
    return null
  }
}

function writeRecord(seat: string, record: StayRecord) {
  localStorage.setItem(storageKey(seat), JSON.stringify(record))
}

export function readStayChoice(seat: string): StayChoice {
  return readRecord(seat)?.choice ?? DEFAULT_STAY
}

export function readStaySession(seat: string): { token: string; account: StayAccount } | null {
  const record = readRecord(seat)
  if (!record || record.choice === 'tab') return null
  if (typeof record.until === 'number' && record.until <= Date.now()) {
    writeRecord(seat, { choice: record.choice })
    return null
  }
  if (!record.token || !record.account) return null
  return {
    token: record.token,
    account: record.account,
  }
}

export function writeStay(
  seat: string,
  choice: StayChoice,
  session: { token: string; account: StayAccount } | null,
) {
  if (choice === 'tab' || !session) {
    writeRecord(seat, { choice })
    return
  }
  const until = choice === 'forever' ? null : Date.now() + (DURATION[choice] ?? 0)
  writeRecord(seat, {
    choice,
    token: session.token,
    account: session.account,
    until,
  })
}

export function clearStaySession(seat: string) {
  const choice = readStayChoice(seat)
  writeRecord(seat, { choice })
}
