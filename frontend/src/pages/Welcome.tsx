import { useState } from 'react'
import { Link, Navigate } from 'react-router-dom'
import { ArrowDown, ArrowRight, Layers, CalendarRange } from 'lucide-react'
import { useAuth } from '../lib/auth'
import { Wordmark } from '../components/PublicShell'
import Building from '../components/welcome/Building'
import { DAY_START, DAY_END, FOCUS_HOUR, MONDAY, ROOM_COUNT, fmtHour } from '../components/welcome/data'
import '../components/welcome/welcome.css'

type Floor = 'all' | 3 | 4
const HOURS = [8, 11, 14, 17, 20, 23]

function RoomSchedule() {
  const [floor, setFloor] = useState<3 | 4>(3)
  const [selected, setSelected] = useState<string | null>(null)
  const rooms = MONDAY.filter((r) => r.floor === floor)
  const room = rooms.find((r) => r.room === selected) ?? rooms[0]
  const scale = (hour: number) => 100 * hour / (DAY_END - DAY_START)
  return (
    <section id="schedule-preview" className="intro-schedule" aria-labelledby="preview-title">
      <div className="intro-wrap intro-schedule-layout">
        <div>
          <CalendarRange size={30} aria-hidden className="intro-symbol" />
          <h2 id="preview-title">같은 건물에서도<br />하루는 다르게 시작합니다.</h2>
          <p>강의실을 선택해 월요일 시간표를 살펴보세요. ON:D는 이 일정과 날씨로 각 공간의 냉난방 시작 시각을 계산합니다.</p>
        </div>
        <div className="intro-board">
          <div className="intro-board-head">
            <h3>IT관 월요일 시간표</h3>
            <div className="intro-switch" role="group" aria-label="시간표 층 선택">
              {([3, 4] as const).map((f) => <button key={f} type="button" aria-pressed={floor === f} onClick={() => { setFloor(f); setSelected(null) }}>{f}층</button>)}
            </div>
          </div>
          <div className="intro-axis" aria-hidden>{HOURS.map((h) => <span key={h}>{h}시</span>)}</div>
          <div role="group" aria-label="강의실 선택">
            {rooms.map((r) => (
              <button key={r.room} type="button" className="intro-room-row" aria-pressed={room.room === r.room} onClick={() => setSelected(r.room)}>
                <span>{r.room}호</span>
                <span className="intro-lane" aria-hidden>{r.sessions.map((s) => (
                  <i key={s.start} style={{ left: scale(s.start - DAY_START) + '%', width: scale(s.end - s.start) + '%' }} />
                ))}</span>
              </button>
            ))}
          </div>
          <div className="intro-session-list" aria-live="polite">
            <strong>{room.room}호 수업 {room.sessions.length}개</strong>
            {room.sessions.length ? <ul>{room.sessions.map((s) => <li key={s.start}><time>{fmtHour(s.start)}–{fmtHour(s.end)}</time>{s.name}</li>)}</ul> : <p>월요일에 등록된 수업이 없습니다.</p>}
          </div>
        </div>
      </div>
    </section>
  )
}

export default function Welcome() {
  const { user } = useAuth()
  const [floor, setFloor] = useState<Floor>('all')
  if (user?.onboarded) return <Navigate to="/" replace />
  const primaryTo = user ? '/setup' : '/signup'
  const primaryLabel = user ? '건물 설정 이어 하기' : '내 건물 연결하기'
  const rows = MONDAY.filter((r) => floor === 'all' || r.floor === floor)
  const starting = rows.filter((r) => r.sessions.some((s) => s.start === FOCUS_HOUR)).length
  return (
    <div className="intro">
      <header className="intro-header">
        <div className="intro-wrap intro-header-row">
          <Link to="/welcome" aria-label="ON:D 소개 처음으로" onClick={() => window.scrollTo(0, 0)}><Wordmark size={29} /></Link>
          <nav aria-label="계정">{!user && <Link to="/login">로그인</Link>}<Link to={primaryTo} className="intro-nav-cta">{user ? primaryLabel : '시작하기'} <ArrowRight size={15} aria-hidden /></Link></nav>
        </div>
      </header>
      <main>
        <section className="intro-hero intro-wrap" aria-labelledby="intro-title">
          <div className="intro-copy">
            <h1 id="intro-title">첫 수업 전에,<br />강의실은 <em>준비 중.</em></h1>
            <p>시간표와 날씨를 읽고 필요한 강의실만 미리 냉난방합니다. 하루의 운전 계획과 예상 절감 효과를 한곳에서 확인하세요.</p>
            <div className="intro-actions">
              {!user && <Link className="intro-primary" to="/login" state={{ demo: true }}>IT관 데모 보기 <ArrowRight size={17} aria-hidden /></Link>}
              <Link className={user ? 'intro-primary' : 'intro-secondary'} to={primaryTo}>{primaryLabel}</Link>
            </div>
            <a className="intro-jump" href="#schedule-preview"><ArrowDown size={15} aria-hidden /> 강의실 시간표 살펴보기</a>
          </div>
          <figure className="intro-model" data-view={floor}>
            <figcaption className="intro-model-caption"><span><Layers size={17} aria-hidden /> 부산대학교 IT관</span><span>월요일 · {fmtHour(FOCUS_HOUR)}</span></figcaption>
            <div className="intro-building"><Building /></div>
            <div className="intro-model-foot">
              <div aria-live="polite"><strong>{starting}<small> / {rows.length}실</small></strong><span>{fmtHour(FOCUS_HOUR)} 수업 시작</span></div>
              <div className="intro-switch" role="group" aria-label="건물 모형 층 선택">
                {(['all', 3, 4] as const).map((f) => <button key={f} type="button" aria-pressed={floor === f} onClick={() => setFloor(f)}>{f === 'all' ? '전체' : f + '층'}</button>)}
              </div>
            </div>
          </figure>
        </section>
        <RoomSchedule />
      </main>
      <footer className="intro-wrap intro-footer"><Wordmark /><span>부산대학교 IT관 · 강의실 {ROOM_COUNT}곳 시뮬레이션</span></footer>
    </div>
  )
}
