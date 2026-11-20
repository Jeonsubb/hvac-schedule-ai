/**
 * Data for the /welcome story. Every session below is copied from the seed timetable
 * (backend/seed/timetable_3_4.csv, 2026-2학기, Monday column). Nothing is invented:
 * the page only shows which rooms have a class and when.
 */

export type Session = { name: string; start: number; end: number } // hours, e.g. 9.5 = 09:30

export interface RoomRow {
  room: string
  floor: 3 | 4
  sessions: Session[]
}

const h = (t: string) => {
  const [hh, mm] = t.split(':').map(Number)
  return hh + mm / 60
}
const s = (name: string, a: string, b: string): Session => ({ name, start: h(a), end: h(b) })

/** Monday sessions per room, top floor first (the order the building is drawn). */
export const MONDAY: RoomRow[] = [
  { room: '405', floor: 4, sessions: [s('확률통계', '09:00', '10:30'), s('인공지능개론', '13:30', '15:00'), s('컴퓨터네트워크', '15:00', '16:30'), s('공학작문및발표', '16:30', '18:30')] },
  { room: '406', floor: 4, sessions: [s('데이터마이닝', '09:00', '10:30'), s('웹응용프로그래밍', '10:30', '12:00'), s('프로그래밍원리와실습', '13:00', '15:00'), s('컴퓨터구조', '15:00', '16:30'), s('프로그래밍원리와실습', '16:30', '18:30')] },
  { room: '407', floor: 4, sessions: [s('공학선형대수학', '13:30', '15:00')] },
  { room: '408', floor: 4, sessions: [] },
  { room: '409', floor: 4, sessions: [s('멀티모달딥러닝', '10:30', '12:00'), s('일반물리학', '15:00', '16:30')] },
  { room: '410', floor: 4, sessions: [s('모빌리티보안', '10:30', '12:00'), s('임베디드시스템설계및실험', '18:30', '22:30')] },
  { room: '306', floor: 3, sessions: [s('자료구조', '09:00', '10:30'), s('공학작문및발표', '10:30', '12:30'), s('데이터베이스', '13:30', '16:30'), s('자료구조', '16:30', '18:00'), s('캡스톤디자인', '19:00', '20:30')] },
  { room: '307', floor: 3, sessions: [s('확률통계', '09:00', '10:30'), s('네트워크보안', '10:30', '12:00'), s('자료구조', '13:30', '16:30'), s('공학선형대수학', '16:30', '18:00')] },
  { room: '309', floor: 3, sessions: [s('컴파일러', '09:00', '10:30'), s('플랫폼기반프로그래밍', '10:30', '12:00'), s('플랫폼기반프로그래밍', '16:30', '18:00'), s('어드벤처디자인', '18:30', '22:30')] },
  { room: '310', floor: 3, sessions: [s('확률통계', '09:00', '12:00'), s('논리회로설계및실험', '18:30', '22:30')] },
]

/** The moment the story zooms in on. */
export const FOCUS_HOUR = 9

/** Rooms whose first Monday class starts at FOCUS_HOUR, and the class name. */
export const FOCUS: Record<string, string> = Object.fromEntries(
  MONDAY.flatMap((r) => r.sessions.filter((x) => x.start === FOCUS_HOUR).map((x) => [r.room, x.name])),
)

export const SESSION_COUNT = MONDAY.reduce((n, r) => n + r.sessions.length, 0)
export const ROOM_COUNT = MONDAY.length

/** Time axis of the timetable scene. */
export const DAY_START = 8
export const DAY_END = 23

/** Schematic floor slots (same order and widths as the app's BuildingView; not a scaled plan). */
export type Slot = { room?: string; label?: string; w: number }
export const SLOTS: Record<3 | 4, Slot[]> = {
  4: [{ room: '405', w: 1 }, { room: '406', w: 1 }, { room: '407', w: 1 }, { room: '408', w: 1 }, { room: '409', w: 1 }, { room: '410', w: 0.92 }, { label: '계단·EV', w: 0.74 }],
  3: [{ room: '306', w: 1 }, { room: '307', w: 1 }, { label: '교수연구실', w: 1 }, { room: '309', w: 1 }, { room: '310', w: 1 }, { label: '세미나실', w: 0.92 }, { label: '계단·EV', w: 0.74 }],
}

export const fmtHour = (t: number) => {
  const hh = Math.floor(t)
  const mm = Math.round((t - hh) * 60)
  return `${String(hh).padStart(2, '0')}:${String(mm === 60 ? 0 : mm).padStart(2, '0')}`
}
