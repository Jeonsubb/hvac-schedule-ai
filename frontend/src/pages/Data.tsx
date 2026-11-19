import { useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import {
  BookOpen,
  Upload,
  CalendarPlus,
  History,
  Search,
  FileSpreadsheet,
  FileImage,
  Sparkles,
  Trash2,
  CheckCircle2,
  AlertTriangle,
  Table2,
  LayoutGrid,
  ArrowRight,
  Download,
  HelpCircle,
} from 'lucide-react'
import { ApiError, apiSend, invalidateAll, pollJob, useApi } from '../lib/api'
import { useMeta } from '../lib/context'
import type { AuditRec, Course, EventDraft, EventRec, EventResult, ImportPreview, ImportResponse, StrategyKey } from '../lib/types'
import { EVENT_TYPE, ROOM_ORDER, STRATEGY, WEEKDAY } from '../lib/constants'
import { EventCheckPanel, eventBody, useEventCheck } from '../components/EventCheck'
import { cx, fmtDateK, fmtKwh, fmtPct, fmtTs, hm, weekdayOf } from '../lib/format'
import { Badge, Button, Card, CardHeader, Empty, ErrorBox, Field, Loading, Modal, PageHeader, Segmented, Spinner, StrategyName, Tabs, inputBase, inputCls, tbl, toast } from '../components/ui'

type Tab = 'courses' | 'import' | 'events' | 'audit'

export default function DataPage() {
  const [params, setParams] = useSearchParams()
  const tab = (params.get('tab') as Tab) || 'courses'
  const { meta } = useMeta()
  const events = useApi<EventRec[]>('/api/events')
  return (
    <div className="space-y-4">
      <PageHeader
        title="일정·데이터"
        desc="AI 운전 계획의 입력인 강의 시간표와, 시간표 밖 일정(보강, 행사, 휴강, 강의실 변경)을 관리합니다. 바꾸면 운전 계획을 바로 다시 계산합니다."
      />
      <Tabs
        value={tab}
        onChange={(v) => setParams({ tab: v }, { replace: true })}
        tabs={[
          { value: 'courses', label: '강의 DB', icon: <BookOpen size={15} />, count: meta?.counts.courses },
          { value: 'import', label: '시간표 가져오기', icon: <Upload size={15} /> },
          { value: 'events', label: '이벤트', icon: <CalendarPlus size={15} />, count: events.data?.length },
          { value: 'audit', label: '변경 기록', icon: <History size={15} /> },
        ]}
      />
      {tab === 'courses' && <CoursesTab />}
      {tab === 'import' && <ImportTab />}
      {tab === 'events' && <EventsTab events={events.data} reload={events.reload} />}
      {tab === 'audit' && <AuditTab />}
    </div>
  )
}

// ---------------------------------------------------------------- courses

function CoursesTab() {
  const courses = useApi<Course[]>('/api/courses')
  const { meta } = useMeta()
  const [q, setQ] = useState('')
  const [room, setRoom] = useState('all')
  const [wd, setWd] = useState('all')
  const [view, setView] = useState<'table' | 'grid'>('table')

  const rows = useMemo(() => {
    const s = q.trim().toLowerCase()
    return (courses.data ?? [])
      .filter((c) => room === 'all' || c.room === room)
      .filter((c) => wd === 'all' || String(c.weekday) === wd)
      .filter((c) => !s || `${c.class_name} ${c.professor ?? ''} ${c.dept ?? ''} ${c.course_code ?? ''}`.toLowerCase().includes(s))
      .sort((a, b) => (a.weekday ?? 9) - (b.weekday ?? 9) || a.start.localeCompare(b.start) || a.room.localeCompare(b.room))
  }, [courses.data, q, room, wd])

  if (courses.error) return <ErrorBox error={courses.error} onRetry={courses.reload} />
  if (!courses.data || !meta) return <Loading />
  const est = courses.data.filter((c) => c.people_estimated).length
  const allEst = est > 0 && est === courses.data.length

  return (
    <Card>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative">
            <Search size={14} className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-ink-3" aria-hidden />
            <input className={cx(inputBase, 'w-[240px] pl-8')} placeholder="과목, 교수, 학과로 검색" aria-label="강의 검색" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          <select className={cx(inputBase, 'w-[120px]')} value={room} onChange={(e) => setRoom(e.target.value)} aria-label="강의실">
            <option value="all">전체 강의실</option>
            {ROOM_ORDER.map((r) => (
              <option key={r} value={r}>
                {r}호
              </option>
            ))}
          </select>
          <select className={cx(inputBase, 'w-[110px]')} value={wd} onChange={(e) => setWd(e.target.value)} aria-label="요일">
            <option value="all">전체 요일</option>
            {WEEKDAY.slice(0, 6).map((w, i) => (
              <option key={w} value={String(i)}>
                {w}요일
              </option>
            ))}
          </select>
          <span className="tnum text-[12.5px] text-ink-3">
            전체 {courses.data.length}건 중 <b className="font-semibold text-ink-2">{rows.length}건</b>
            {allEst ? ', 예상 인원은 모두 정원·학년으로 추정한 값' : `, 인원 추정 ${est}건`}
          </span>
        </div>
        <Segmented
          label="보기 방식"
          value={view}
          onChange={setView}
          options={[
            { value: 'table', label: <span className="inline-flex items-center gap-1"><Table2 size={13} />목록</span> },
            { value: 'grid', label: <span className="inline-flex items-center gap-1"><LayoutGrid size={13} />주간 시간표</span> },
          ]}
        />
      </div>
      {view === 'table' ? (
        <div className="thin-scroll max-h-[640px] overflow-auto rounded-[6px] border border-line">
          <table className={tbl.table}>
            <thead className={cx(tbl.thead, 'sticky top-0 z-[1]')}>
              <tr>
                <th className={tbl.th}>요일</th>
                <th className={tbl.th}>시간</th>
                <th className={tbl.th}>강의실</th>
                <th className={tbl.th}>과목</th>
                <th className={tbl.th}>교수</th>
                <th className={tbl.th}>학과, 학년</th>
                <th className={tbl.thR}>{allEst ? '예상 인원(추정)' : '예상 인원'}</th>
                <th className={tbl.th}>출처</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((c) => (
                <tr key={c.id} className={cx(tbl.tr, 'hover:bg-well')}>
                  <td className="px-3 py-1.5 font-medium whitespace-nowrap">{c.weekday != null ? WEEKDAY[c.weekday] : c.date}</td>
                  <td className="px-3 py-1.5 whitespace-nowrap text-ink-2">
                    {c.start}–{c.end}
                  </td>
                  <td className="px-3 py-1.5 whitespace-nowrap">
                    <span className="font-semibold">{c.room}</span> <span className="text-[12px] text-ink-3">{meta.rooms[c.room]?.type_label}</span>
                  </td>
                  <td className="px-3 py-1.5 font-medium text-ink">
                    {c.class_name}
                    {c.course_code && <span className="ml-1.5 text-[11.5px] font-normal text-ink-3">{c.course_code}-{c.section}</span>}
                  </td>
                  <td className="px-3 py-1.5 text-ink-2">{c.professor}</td>
                  <td className="px-3 py-1.5 whitespace-nowrap text-ink-2">
                    {[c.dept, c.grade].filter(Boolean).join(', ')}
                  </td>
                  <td className="px-3 py-1.5 text-right whitespace-nowrap">
                    <span className="inline-flex items-center gap-1.5">
                      {c.expected_people ?? '–'}명
                      {c.people_estimated && !allEst && (
                        <Badge tone="warn" title="수강 인원 정보가 없어 강의실 정원·학년으로 추정">
                          추정
                        </Badge>
                      )}
                    </span>
                  </td>
                  <td className="px-3 py-1.5 text-[12px] whitespace-nowrap text-ink-3">{c.source}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {rows.length === 0 && <Empty title="조건에 맞는 강의가 없습니다" desc="검색어를 지우거나 강의실·요일 필터를 전체로 바꿔 보세요." />}
        </div>
      ) : (
        <WeekGrid courses={rows} roomFilter={room} />
      )}
    </Card>
  )
}

function WeekGrid({ courses, roomFilter }: { courses: Course[]; roomFilter: string }) {
  const r0 = 8 * 60
  const r1 = 22 * 60
  const H = 30 // px per hour
  const days = [0, 1, 2, 3, 4]
  const rooms = roomFilter === 'all' ? ROOM_ORDER : [roomFilter]
  const roomIdx = Object.fromEntries(rooms.map((r, i) => [r, i]))
  return (
    <div className="overflow-x-auto">
      <div className="flex min-w-[900px]">
        <div className="w-12 shrink-0 pt-7">
          {Array.from({ length: (r1 - r0) / 60 + 1 }, (_, i) => (
            <div key={i} className="tnum relative text-right text-[11px] text-ink-3" style={{ height: i === (r1 - r0) / 60 ? 0 : H }}>
              <span className="absolute -top-1.5 right-2">{String(8 + i).padStart(2, '0')}</span>
            </div>
          ))}
        </div>
        {days.map((d) => (
          <div key={d} className="flex-1 border-l border-line">
            <div className="h-7 border-b border-line text-center text-[13px] leading-7 font-semibold text-ink">{WEEKDAY[d]}요일</div>
            <div className="relative" style={{ height: ((r1 - r0) / 60) * H }}>
              {Array.from({ length: (r1 - r0) / 60 }, (_, i) => (
                <div key={i} className="absolute inset-x-0 border-t border-line" style={{ top: i * H }} />
              ))}
              {courses
                .filter((c) => c.weekday === d && roomIdx[c.room] !== undefined)
                .map((c) => {
                  const a = hm(c.start)
                  const b = hm(c.end)
                  const n = rooms.length
                  const w = 100 / n
                  return (
                    <div
                      key={c.id}
                      className="absolute overflow-hidden rounded-[3px] border-l-[3px] border-ink bg-[#e8ecf2] px-1 py-0.5 text-[11px] leading-tight"
                      style={{
                        top: ((a - r0) / 60) * H + 1,
                        height: ((b - a) / 60) * H - 2,
                        left: `calc(${roomIdx[c.room] * w}% + 1px)`,
                        width: `calc(${w}% - 2px)`,
                      }}
                      title={`${c.room}호 ${c.class_name} ${c.start}–${c.end}, ${c.professor ?? ''}, ${c.expected_people}명`}
                    >
                      {n <= 2 ? (
                        <>
                          <div className="truncate font-semibold text-ink">{c.class_name}</div>
                          <div className="truncate text-ink-3">
                            {c.start}–{c.end}, {c.expected_people}명
                          </div>
                        </>
                      ) : (
                        <div className="font-semibold text-ink">{c.room.slice(1)}</div>
                      )}
                    </div>
                  )
                })}
            </div>
          </div>
        ))}
      </div>
      {rooms.length > 2 && (
        <p className="mt-2 text-[12px] text-ink-3">
          요일 칸 안에서 왼쪽부터 {rooms.join(', ')}호 순서이고, 블록의 숫자는 호수 끝 두 자리입니다. 강의실을 하나 고르면 과목명이 보입니다.
        </p>
      )}
    </div>
  )
}

// ---------------------------------------------------------------- import

function ImportTab() {
  const [drag, setDrag] = useState(false)
  const [hint, setHint] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [res, setRes] = useState<{ source: string; preview: ImportPreview; notes?: string; raw?: number } | null>(null)
  const [committed, setCommitted] = useState<{ weekly: number; dated: number } | null>(null)
  const [mode, setMode] = useState<'rooms' | 'all'>('rooms')
  const fileRef = useRef<HTMLInputElement>(null)
  const current = useApi<Course[]>('/api/courses')

  // Content-based diff (room·요일·시간·과목): IDs from images lack course code/section, so ID diff over-reports.
  const diff = useMemo(() => {
    if (!res || !current.data) return null
    const weeklyNew = res.preview.courses.filter((c) => c.weekday != null)
    const dated = res.preview.courses.filter((c) => c.weekday == null && c.date)
    const fileRooms = new Set(weeklyNew.map((c) => c.room))
    const curRooms = new Set(current.data.map((c) => c.room))
    const partial = fileRooms.size > 0 && [...curRooms].some((r) => !fileRooms.has(r))
    const effMode = partial ? mode : 'all'
    const scope = effMode === 'rooms' ? current.data.filter((c) => fileRooms.has(c.room)) : current.data
    const curKeys = new Set(scope.map(courseKey))
    const newKeys = new Set(weeklyNew.map(courseKey))
    const added = weeklyNew.filter((c) => !curKeys.has(courseKey(c)))
    const removed = weeklyNew.length ? scope.filter((c) => !newKeys.has(courseKey(c))) : []
    const unchanged = weeklyNew.filter((c) => curKeys.has(courseKey(c))).length
    const kept = effMode === 'rooms' ? current.data.filter((c) => !fileRooms.has(c.room)) : []
    const payload = weeklyNew.length ? [...kept, ...res.preview.courses] : res.preview.courses
    return { weeklyNew, dated, fileRooms: [...fileRooms].sort(), partial, effMode, added, removed, unchanged, kept: kept.length, payload }
  }, [res, current.data, mode])

  const upload = async (f: File) => {
    setErr(null)
    setRes(null)
    setCommitted(null)
    const isAi = /\.(png|jpe?g|webp|gif|pdf)$/i.test(f.name)
    setBusy(isAi ? 'AI가 시간표 이미지를 읽고 있습니다… (Claude Sonnet, 10~60초)' : '파일을 분석하는 중…')
    try {
      const fd = new FormData()
      fd.append('file', f)
      if (hint) fd.append('hint', hint)
      const r = await apiSend<ImportResponse>('POST', '/api/import', fd)
      if (r.mode === 'sync' && r.preview) {
        setRes({ source: r.source, preview: r.preview })
      } else if (r.job) {
        const job = await pollJob<{ preview: ImportPreview; notes: string; raw_count: number }>(r.job, undefined, { intervalMs: 2000, timeoutMs: 240_000 })
        if (job.status === 'error' || !job.result) throw new Error(job.error || '이미지에서 시간표를 읽지 못했습니다.')
        setRes({ source: r.source, preview: job.result.preview, notes: job.result.notes, raw: job.result.raw_count })
      }
    } catch (e) {
      setErr((e as Error).message)
    } finally {
      setBusy(null)
    }
  }

  const commit = async () => {
    if (!res) return
    setBusy('강의 DB에 반영하고 학기 전체를 다시 계산하는 중…')
    try {
      const r = await apiSend<{ weekly: number; dated: number }>('POST', '/api/import/commit', { courses: diff?.payload ?? res.preview.courses, source: res.source })
      setCommitted(r)
      invalidateAll()
      toast(`강의 DB에 반영했습니다. 주간 강의 ${r.weekly}개, 일회성 일정 ${r.dated}개`)
    } catch (e) {
      setErr((e as Error).message)
    } finally {
      setBusy(null)
    }
  }

  const template = () => {
    const csv =
      '﻿건물,강의실,요일,시작,종료,과목명,교수,학년,수강인원\nIT관,405,월,09:00,10:30,자료구조,홍길동,2학년,45\nIT관,309,수,13:30,16:30,웹응용프로그래밍,김철수,3학년,\n'
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }))
    const a = document.createElement('a')
    a.href = url
    a.download = 'timetable_template.csv'
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.6fr)]">
      <Card>
        <CardHeader title="파일 올리기" sub="학교 시간표 시스템에서 내려받은 파일이나 시간표 사진을 그대로 올리세요." />
        <div
          onDragOver={(e) => {
            e.preventDefault()
            setDrag(true)
          }}
          onDragLeave={() => setDrag(false)}
          onDrop={(e) => {
            e.preventDefault()
            setDrag(false)
            const f = e.dataTransfer.files?.[0]
            if (f) upload(f)
          }}
          onClick={() => !busy && fileRef.current?.click()}
          role="button"
          tabIndex={0}
          aria-label="시간표 파일 선택"
          onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && !busy && (e.preventDefault(), fileRef.current?.click())}
          className={cx(
            'flex cursor-pointer flex-col items-center justify-center gap-2 rounded-[8px] border-[1.5px] border-dashed px-6 py-10 text-center transition-colors',
            drag ? 'border-ink bg-well' : 'border-line-strong hover:border-ink-4 hover:bg-well',
            busy && 'pointer-events-none opacity-60',
          )}
        >
          <div className="flex gap-2 text-ink-3">
            <FileSpreadsheet size={26} />
            <FileImage size={26} />
          </div>
          <div className="text-[14px] font-semibold text-ink">파일을 여기로 끌어 놓거나 눌러서 고르세요</div>
          <div className="text-[12.5px] text-ink-3">CSV, XLSX, JSON은 바로 비교하고, PNG, JPG, PDF는 AI가 읽어서 바꿉니다</div>
          <input
            ref={fileRef}
            type="file"
            className="hidden"
            accept=".csv,.xlsx,.xlsm,.json,.png,.jpg,.jpeg,.webp,.gif,.pdf"
            onChange={(e) => {
              const f = e.target.files?.[0]
              if (f) upload(f)
              e.target.value = ''
            }}
          />
        </div>
        <Field label="AI 판독 힌트 (이미지·PDF일 때, 선택)" className="mt-4">
          <input className={inputCls} placeholder="예: IT관 4층 시간표, 학년 표기는 무시" value={hint} onChange={(e) => setHint(e.target.value)} />
        </Field>
        <div className="mt-4 rounded-[6px] bg-well p-3 text-[12.5px] leading-relaxed text-ink-2 ring-1 ring-line ring-inset">
          <div className="mb-1 font-semibold text-ink">지원 형식</div>
          <ul className="list-disc space-y-0.5 pl-4">
            <li>학교 시간표 격자 CSV/XLSX (강의실번호 × 30분 칸 × 요일)</li>
            <li>목록형 CSV/JSON: 강의실, 요일 또는 날짜, 시작, 종료, 과목명, 교수, 학년, 수강인원</li>
            <li>날짜가 있는 행은 일회성 일정(이벤트)으로 등록됩니다</li>
            <li>수강인원이 비어 있으면 강의실 정원·학년으로 추정합니다</li>
          </ul>
          <button onClick={template} className="mt-2 inline-flex items-center gap-1 font-semibold text-ink underline-offset-2 hover:underline">
            <Download size={12} /> 목록형 CSV 양식 내려받기
          </button>
        </div>
      </Card>

      <Card>
        <CardHeader title="변경 미리보기" sub="반영하기 전에 현재 강의 DB와 무엇이 달라지는지 확인합니다." />
        {busy && (
          <div className="flex items-center gap-2 rounded-[6px] bg-well px-4 py-3 text-[13px] text-ink ring-1 ring-line ring-inset" role="status">
            <Spinner className="text-ink" /> {busy}
          </div>
        )}
        {err && <ErrorBox error={err} />}
        {!busy && !res && !err && <Empty title="아직 올린 파일이 없습니다" desc="왼쪽에 시간표 파일을 올리면 추가, 삭제, 유지되는 강의를 여기에 보여 줍니다." icon={<Upload size={17} />} />}
        {res && (
          <div className="space-y-4">
            <div className="text-[12.5px] text-ink-2">
              <b className="text-ink">{res.source}</b>
              {res.raw != null && `, AI가 ${res.raw}개 칸을 읽음`}
            </div>
            {res.notes && <div className="rounded-[6px] bg-well px-3 py-2 text-[12.5px] text-ink-2 ring-1 ring-line ring-inset">AI 메모: {res.notes}</div>}
            {!diff ? (
              <Loading label="현재 강의 DB와 비교하는 중…" className="py-4" />
            ) : (
              <>
                {diff.partial && (
                  <div className="rounded-[6px] border border-line p-3">
                    <div className="mb-2 text-[12.5px] text-ink-2">
                      이 파일에는 <b className="text-ink">{diff.fileRooms.join(', ')}호</b>만 들어 있습니다. 반영 방식을 고르세요.
                    </div>
                    <Segmented
                      value={mode}
                      onChange={setMode}
                      options={[
                        { value: 'rooms', label: `이 강의실만 교체 (나머지 ${diff.kept}개 유지)` },
                        { value: 'all', label: '강의 DB 전체를 이 파일로 교체' },
                      ]}
                    />
                  </div>
                )}
                <div className="grid grid-cols-5 gap-px overflow-hidden rounded-[6px] border border-line bg-line">
                  <MiniStat label="파일의 주간 강의" value={diff.weeklyNew.length} />
                  <MiniStat label="새로 추가" value={diff.added.length} tone={diff.added.length ? 'good' : undefined} />
                  <MiniStat label="삭제" value={diff.removed.length} tone={diff.removed.length ? 'crit' : undefined} />
                  <MiniStat label="변경 없음" value={diff.unchanged} />
                  <MiniStat label="일회성 일정" value={diff.dated.length} />
                </div>
                {diff.effMode === 'all' && diff.removed.length > 20 && (
                  <div className="flex items-start gap-2 rounded-[6px] border border-[#efc6c6] bg-crit-bg px-3 py-2 text-[12.5px] text-crit-ink">
                    <AlertTriangle size={14} className="mt-0.5 shrink-0" /> 반영하면 기존 강의 {diff.removed.length}개가 시간표에서 사라집니다. 일부 강의실 파일이라면 &lsquo;이 강의실만 교체&rsquo;를 고르세요.
                  </div>
                )}
                {diff.added.length > 0 && <DiffTable title="추가되는 강의" tone="good" rows={diff.added} />}
                {diff.removed.length > 0 && <DiffTable title="삭제되는 강의 (파일에 없음)" tone="crit" rows={diff.removed} />}
                {diff.added.length === 0 && diff.removed.length === 0 && (
                  <div className="flex items-center gap-2 rounded-[6px] bg-good-bg px-3 py-2 text-[12.5px] text-good-ink">
                    <CheckCircle2 size={14} /> 시간표 내용이 현재 강의 DB와 같습니다{diff.dated.length ? `. 일회성 일정 ${diff.dated.length}개는 이벤트로 추가됩니다` : ''}.
                  </div>
                )}
              </>
            )}
            {committed ? (
              <div className="flex items-center gap-2 rounded-[6px] bg-good-bg px-3 py-2.5 text-[13px] text-good-ink">
                <CheckCircle2 size={15} /> 반영했습니다. 주간 강의 {committed.weekly}개, 일회성 일정 {committed.dated}개로 운전 계획을 다시 계산했습니다.
              </div>
            ) : (
              <div className="flex items-center justify-between gap-3 border-t border-line pt-3">
                <span className="flex items-center gap-1.5 text-[12px] text-ink-3">
                  <AlertTriangle size={13} />
                  {diff?.effMode === 'rooms' ? `${diff.fileRooms.join('·')}호 시간표만 바뀌고 변경 기록에 남습니다.` : '주간 강의 DB가 이 파일 내용으로 교체되고 변경 기록에 남습니다.'}
                </span>
                <Button variant="primary" onClick={commit} disabled={!!busy || res.preview.count === 0 || !diff}>
                  강의 DB에 반영
                </Button>
              </div>
            )}
          </div>
        )}
      </Card>
    </div>
  )
}

function courseKey(c: Course) {
  return `${c.room}|${c.weekday ?? c.date}|${c.start}|${c.end}|${c.class_name.replace(/\s+/g, '')}`
}

function MiniStat({ label, value, tone }: { label: string; value: number; tone?: 'good' | 'crit' }) {
  return (
    <div className="bg-surface px-3 py-2.5">
      <div className="text-[12px] text-ink-3">{label}</div>
      <div className={cx('pnum mt-0.5 text-[20px] font-[650]', tone === 'good' ? 'text-good-ink' : tone === 'crit' ? 'text-crit-ink' : 'text-ink')}>{value}</div>
    </div>
  )
}

function DiffTable({ title, rows, tone }: { title: string; rows: Course[]; tone: 'good' | 'crit' }) {
  return (
    <div>
      <div className={cx('mb-1.5 text-[12.5px] font-semibold', tone === 'good' ? 'text-good-ink' : 'text-crit-ink')}>
        {tone === 'good' ? '+' : '−'} {title} {rows.length}건
      </div>
      <div className="thin-scroll max-h-[220px] overflow-auto rounded-[6px] border border-line">
        <table className="tnum w-full text-[12px]">
          <tbody>
            {rows.slice(0, 100).map((c) => (
              <tr key={c.id} className="border-t border-line first:border-t-0">
                <td className="px-3 py-1.5 font-semibold">{c.room}</td>
                <td className="px-2 py-1.5">{c.weekday != null ? WEEKDAY[c.weekday] : c.date}</td>
                <td className="px-2 py-1.5 whitespace-nowrap text-ink-2">
                  {c.start}–{c.end}
                </td>
                <td className="px-2 py-1.5 font-medium">{c.class_name}</td>
                <td className="px-2 py-1.5 text-ink-2">{c.professor}</td>
                <td className="px-3 py-1.5 text-right text-ink-2">{c.expected_people}명</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------- events

const EXAMPLES = [
  '27일 금 14~17시 405호 졸업작품 발표 80명',
  '다음 주 수요일 405호 18~21시 특강 40명',
  '12월 3일 컴퓨터구조 휴강',
  '11월 26일 IT관 전체 휴관',
]

const emptyDraft = (date: string): EventDraft => ({ type: 'add', date, room: '405', start: '18:00', end: '20:00', title: '', expected_people: 40 })

export function EventsTab({ events, reload }: { events: EventRec[] | undefined; reload: () => void }) {
  const { meta } = useMeta()
  const [text, setText] = useState('')
  const [parsing, setParsing] = useState(false)
  const [draft, setDraft] = useState<EventDraft | null>(null)
  const [clar, setClar] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [result, setResult] = useState<EventResult | null>(null)
  const [del, setDel] = useState<EventRec | null>(null)
  const [origin, setOrigin] = useState<{ kind: 'text' | 'image' | 'manual'; label?: string; url?: string } | null>(null)
  const [reading, setReading] = useState(false)
  const [imgErr, setImgErr] = useState<{ msg: string; fallback: boolean } | null>(null)
  const [saveErr, setSaveErr] = useState<string | null>(null)
  const textRef = useRef<HTMLInputElement>(null)
  const imgRef = useRef<HTMLInputElement>(null)
  const [dragImg, setDragImg] = useState(false)

  const parse = async (t = text) => {
    if (!t.trim()) return
    setParsing(true)
    setErr(null)
    setImgErr(null)
    setResult(null)
    try {
      const d = await apiSend<EventDraft>('POST', '/api/events/parse', { text: t })
      setClar(d.clarification ?? null)
      setDraft({ ...d, clarification: undefined })
      setOrigin({ kind: 'text', label: t })
    } catch (e) {
      const st = e instanceof ApiError ? e.status : 0
      if (st === 422) setErr('일정으로 해석하지 못했습니다. 날짜, 강의실, 시간을 넣어 다시 적어 주세요. 예: 27일 금 14~17시 405호 특강 40명')
      else if (st === 429) setErr('요청이 많아 잠시 멈췄습니다. 1분쯤 뒤 다시 시도하거나 아래 직접 입력으로 양식을 채워 주세요.')
      else if (st === 503) setErr('AI가 지금 응답하지 않습니다. 아래 직접 입력으로 양식을 채워 주세요.')
      else setErr((e as Error).message)
    } finally {
      setParsing(false)
    }
  }

  // LMS notice screenshot -> draft (same shape as /parse, with `check`)
  const parseImage = async (f: File) => {
    setImgErr(null)
    setErr(null)
    setResult(null)
    if (!/^image\/(png|jpe?g|webp)$/.test(f.type)) {
      setImgErr({ msg: 'PNG, JPG, WEBP 이미지만 올릴 수 있습니다. 공지 화면을 캡처해 올려 주세요.', fallback: false })
      return
    }
    if (f.size > 4 * 1024 * 1024) {
      setImgErr({ msg: `이미지가 ${(f.size / 1024 / 1024).toFixed(1)}MB입니다. 4MB 이하로 줄여 다시 올려 주세요.`, fallback: false })
      return
    }
    setReading(true)
    try {
      const fd = new FormData()
      fd.append('file', f)
      const d = await apiSend<EventDraft>('POST', '/api/events/parse-image', fd)
      setClar(d.clarification ?? null)
      setDraft({ ...d, clarification: undefined })
      setOrigin({ kind: 'image', label: f.name, url: URL.createObjectURL(f) })
    } catch (e) {
      const st = e instanceof ApiError ? e.status : 0
      if (st === 422) setImgErr({ msg: '공지에서 일정을 찾지 못했습니다. 날짜, 시간, 강의실이 보이도록 공지 부분만 잘라 다시 올리거나, 글로 입력해 주세요.', fallback: true })
      else if (st === 400 || st === 413) setImgErr({ msg: e instanceof Error && e.message ? e.message : 'PNG, JPG, WEBP 이미지(4MB 이하)만 올릴 수 있습니다.', fallback: false })
      else if (st === 429) setImgErr({ msg: `요청이 많아 잠시 멈췄습니다. 1분쯤 뒤 다시 올리거나, 공지 내용을 글로 입력해 주세요.`, fallback: true })
      else if (st === 503) setImgErr({ msg: 'AI가 지금 이미지를 읽을 수 없습니다. 공지 내용을 글로 입력해 주세요.', fallback: true })
      else setImgErr({ msg: `${(e as Error).message} 공지 내용을 글로 입력해 주세요.`, fallback: true })
    } finally {
      setReading(false)
    }
  }

  const trySample = async () => {
    try {
      const b = await (await fetch('/samples/lms-cancel-notice.png')).blob()
      await parseImage(new File([b], 'LMS 휴강 공지(예시).png', { type: 'image/png' }))
    } catch {
      setImgErr({ msg: '예시 이미지를 불러오지 못했습니다. 직접 캡처한 공지를 올려 주세요.', fallback: false })
    }
  }

  const save = async () => {
    if (!draft) return
    setSaving(true)
    setSaveErr(null)
    try {
      const r = await apiSend<EventResult>('POST', '/api/events', eventBody(draft))
      setResult(r)
      setDraft(null)
      setText('')
      setClar(null)
      invalidateAll()
      reload()
      toast('이벤트를 등록하고 운전 계획을 다시 계산했습니다.')
    } catch (e) {
      setSaveErr((e as Error).message)
    } finally {
      setSaving(false)
    }
  }

  const remove = async (ev: EventRec) => {
    try {
      await apiSend('DELETE', `/api/events/${ev.id}`)
      invalidateAll()
      reload()
      toast('이벤트를 삭제하고 그날 운전 계획을 다시 계산했습니다.')
    } catch (e) {
      toast((e as Error).message, 'crit')
    } finally {
      setDel(null)
    }
  }

  if (!meta) return <Loading />

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <Card>
          <CardHeader
            title="일정 등록"
            sub="말로 적거나 LMS 공지 화면을 올리면 AI가 일정 양식으로 바꿉니다. 등록하기 전에 겹치는 일정을 확인하고 직접 고칠 수 있습니다."
          />
          <div className="mb-1.5 text-[12.5px] font-semibold text-ink-2">글로 적기</div>
          <form
            onSubmit={(e) => {
              e.preventDefault()
              parse()
            }}
            className="flex gap-2"
          >
            <input
              ref={textRef}
              className={cx(inputCls, 'h-10 flex-1 text-[13.5px]')}
              aria-label="일정 설명"
              placeholder="예: 27일 금 14~17시 405호 졸업작품 발표 80명"
              value={text}
              onChange={(e) => setText(e.target.value)}
            />
            <Button type="submit" variant="primary" disabled={parsing || !text.trim()} className="h-10">
              {parsing ? <Spinner className="text-white" /> : <Sparkles size={15} />}
              AI로 해석
            </Button>
          </form>
          <div className="mt-2.5 flex flex-wrap gap-1.5">
            {EXAMPLES.map((ex) => (
              <button
                key={ex}
                onClick={() => {
                  setText(ex)
                  parse(ex)
                }}
                className="rounded-[6px] border border-line bg-surface px-2.5 py-1 text-[12.5px] text-ink-2 hover:border-line-strong hover:text-ink"
              >
                {ex}
              </button>
            ))}
          </div>
          {err && (
            <div className="mt-3">
              <ErrorBox error={err} />
            </div>
          )}

          <div className="mt-5 mb-1.5 flex items-center justify-between gap-2 border-t border-line pt-4">
            <span className="text-[12.5px] font-semibold text-ink-2">공지 이미지로</span>
            <button className="text-[12.5px] font-semibold text-ink underline-offset-2 hover:underline disabled:opacity-40" onClick={trySample} disabled={reading}>
              예시 휴강 공지로 해 보기
            </button>
          </div>
          <div
            role="button"
            tabIndex={0}
            aria-label="LMS 공지 이미지 선택"
            onClick={() => !reading && imgRef.current?.click()}
            onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && !reading && (e.preventDefault(), imgRef.current?.click())}
            onDragOver={(e) => {
              e.preventDefault()
              setDragImg(true)
            }}
            onDragLeave={() => setDragImg(false)}
            onDrop={(e) => {
              e.preventDefault()
              setDragImg(false)
              const f = e.dataTransfer.files?.[0]
              if (f) parseImage(f)
            }}
            className={cx(
              'flex cursor-pointer items-center gap-3 rounded-[8px] border-[1.5px] border-dashed px-4 py-3.5 transition-colors',
              dragImg ? 'border-ink bg-well' : 'border-line-strong hover:border-ink-4 hover:bg-well',
              reading && 'pointer-events-none opacity-70',
            )}
          >
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-well text-ink-3 ring-1 ring-line" aria-hidden>
              {reading ? <Spinner size={16} /> : <FileImage size={17} />}
            </span>
            <span className="min-w-0">
              <span className="block text-[13px] font-semibold text-ink">{reading ? 'AI가 공지를 읽는 중…' : '휴강·보강·강의실 변경 공지 캡처를 끌어 놓거나 눌러서 고르세요'}</span>
              <span className="block text-[12px] text-ink-3">PNG, JPG, WEBP 4MB 이하. 교수가 휴강을 올리면 그 시간 냉난방을 켜지 않습니다.</span>
            </span>
            <input
              ref={imgRef}
              type="file"
              className="hidden"
              accept="image/png,image/jpeg,image/webp"
              onChange={(e) => {
                const f = e.target.files?.[0]
                if (f) parseImage(f)
                e.target.value = ''
              }}
            />
          </div>
          {imgErr && (
            <div className="mt-2 flex flex-wrap items-start justify-between gap-2 rounded-[6px] border border-[#efc6c6] bg-crit-bg px-3 py-2 text-[12.5px] text-crit-ink" role="alert">
              <span className="flex items-start gap-1.5">
                <AlertTriangle size={13} className="mt-0.5 shrink-0" aria-hidden />
                {imgErr.msg}
              </span>
              {imgErr.fallback && (
                <Button size="sm" onClick={() => textRef.current?.focus()}>
                  글로 입력하기
                </Button>
              )}
            </div>
          )}

          <div className="mt-4 flex items-center gap-2 text-[12.5px] text-ink-3">
            양식을 바로 채우려면
            <button
              className="font-semibold text-ink underline-offset-2 hover:underline"
              onClick={() => {
                setDraft(emptyDraft(meta.now.date))
                setClar(null)
                setResult(null)
                setOrigin({ kind: 'manual' })
              }}
            >
              직접 입력
            </button>
          </div>
        </Card>

        <Card>
          <CardHeader title="일정 확인" sub={draft ? '내용을 확인하고, 필요하면 고친 뒤 등록하세요.' : 'AI가 해석한 일정이 여기에 나옵니다.'} />
          {draft ? (
            <div className="space-y-3">
              {origin && origin.kind !== 'manual' && (
                <div className="flex items-start gap-3 rounded-[6px] bg-well px-3 py-2 text-[12.5px] text-ink-2 ring-1 ring-line ring-inset">
                  {origin.url && <img src={origin.url} alt="올린 공지 이미지" className="h-14 w-20 shrink-0 rounded-[4px] object-cover object-top ring-1 ring-line" />}
                  <span className="min-w-0">
                    <span className="font-semibold text-ink">{origin.kind === 'image' ? '공지 이미지에서 읽음' : '글에서 해석'}</span>
                    <span className="block truncate text-ink-3">{origin.label}</span>
                    {draft.from_cache && (
                      <span className="mt-0.5 block text-ink-2">
                        AI 연결이 불안정해 {draft.cached_at ? fmtTs(draft.cached_at) : '오늘 앞서'} 같은 내용을 해석한 결과를 썼습니다. 내용을 한 번 더 확인하세요.
                      </span>
                    )}
                  </span>
                </div>
              )}
              <EventForm draft={draft} onChange={setDraft} clarification={clar} saving={saving} onSave={save} onCancel={() => setDraft(null)} />
              {saveErr && <ErrorBox title="등록하지 못했습니다" error={saveErr} />}
            </div>
          ) : result ? (
            <BeforeAfter r={result} />
          ) : (
            <Empty title="확인할 일정이 없습니다" desc="왼쪽에 일정을 적거나 예시 문장을 눌러 보세요." icon={<CalendarPlus size={17} />} />
          )}
        </Card>
      </div>

      <Card>
        <CardHeader title="등록된 이벤트" sub="시간표 밖 일정을 날짜순으로 보여 줍니다." />
        {!events ? (
          <Loading />
        ) : events.length === 0 ? (
          <Empty title="등록된 이벤트가 없습니다" desc="보강, 특강, 휴강, 강의실 변경이 생기면 위에서 말로 등록하세요." icon={<CalendarPlus size={17} />} />
        ) : (
          <div className={tbl.frame}>
            <table className={tbl.table}>
              <thead className={tbl.thead}>
                <tr>
                  <th className={tbl.th}>날짜</th>
                  <th className={tbl.th}>유형</th>
                  <th className={tbl.th}>강의실</th>
                  <th className={tbl.th}>시간</th>
                  <th className={tbl.th}>내용</th>
                  <th className={tbl.thR}>인원</th>
                  <th className={tbl.th}>등록</th>
                  <th className={tbl.th}>
                    <span className="sr-only">삭제</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {events.map((e) => (
                  <tr key={e.id} className={tbl.tr}>
                    <td className="px-3 py-2 font-medium">{fmtDateK(e.date)}</td>
                    <td className="px-3 py-2">
                      <Badge tone={e.type === 'add' ? 'event' : e.type === 'cancel' || e.type === 'closure' ? 'crit' : 'info'}>{EVENT_TYPE[e.type] ?? e.type}</Badge>
                    </td>
                    <td className="px-3 py-2">
                      {e.room ?? (e.type === 'closure' ? '전체' : '–')}
                      {e.new_room && ` → ${e.new_room}`}
                    </td>
                    <td className="px-3 py-2 text-ink-2">{e.start ? `${e.start}–${e.end}` : '–'}</td>
                    <td className="px-3 py-2">{e.title || '–'}</td>
                    <td className="px-3 py-2 text-right">{e.expected_people ?? '–'}</td>
                    <td className="px-3 py-2 text-[12px] text-ink-3">{e.created_at ? fmtTs(e.created_at) : e.source ?? ''}</td>
                    <td className="px-3 py-2 text-right">
                      <Button size="sm" variant="danger" onClick={() => setDel(e)}>
                        <Trash2 size={12} /> 삭제
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Modal
        open={!!del}
        onClose={() => setDel(null)}
        title="이벤트 삭제"
        footer={
          <>
            <Button onClick={() => setDel(null)}>취소</Button>
            <Button variant="danger" onClick={() => del && remove(del)}>
              <Trash2 size={13} /> 삭제
            </Button>
          </>
        }
      >
        {del && (
          <p className="text-[13px] text-ink-2">
            <b className="text-ink">
              {fmtDateK(del.date)} {del.room ? `${del.room}호 ` : ''}
              {del.title}
            </b>{' '}
            ({EVENT_TYPE[del.type]}) 일정을 삭제하고 그날 운전 계획을 다시 계산합니다.
          </p>
        )}
      </Modal>
    </div>
  )
}

export function EventForm({
  draft,
  onChange,
  clarification,
  saving,
  onSave,
  onCancel,
  compact = false,
}: {
  draft: EventDraft
  onChange: (d: EventDraft) => void
  clarification?: string | null
  saving: boolean
  onSave: () => void
  onCancel?: () => void
  compact?: boolean
}) {
  const { meta } = useMeta()
  const courses = useApi<Course[]>('/api/courses')
  // any edit invalidates the check that came with the parsed draft; the hook re-checks after a pause
  const set = (p: Partial<EventDraft>) => onChange({ ...draft, ...p, check: undefined })
  const checked = useEventCheck(draft, draft.check)
  const t = draft.type
  const wd = draft.date ? weekdayOf(draft.date) : null
  const dayCourses = (courses.data ?? []).filter((c) => c.weekday === wd).sort((a, b) => a.room.localeCompare(b.room) || a.start.localeCompare(b.start))
  const inSem = meta && draft.date >= meta.semester.start && draft.date <= meta.semester.end
  const valid =
    !!draft.date &&
    (t !== 'add' || (!!draft.room && !!draft.start && !!draft.end && hm(draft.end) > hm(draft.start))) &&
    (t !== 'cancel' || !!draft.course_id) &&
    (t !== 'move' || (!!draft.course_id && !!draft.new_room))
  const room = draft.room ? meta?.rooms[draft.room] : undefined
  const over = !!room && draft.expected_people != null && draft.expected_people > room.capacity

  return (
    <div className="space-y-3">
      {clarification && (
        <div className="flex items-start gap-2 rounded-[6px] bg-warn-bg px-3 py-2 text-[12.5px] text-warn-ink">
          <HelpCircle size={14} className="mt-0.5 shrink-0" /> AI가 확인을 요청했습니다: {clarification}
        </div>
      )}
      <div className={cx('grid gap-3', compact ? 'grid-cols-2' : 'grid-cols-3')}>
        <Field label="유형">
          <select className={inputCls} value={t} onChange={(e) => set({ type: e.target.value as EventDraft['type'] })}>
            {Object.entries(EVENT_TYPE).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </Field>
        <Field label="날짜" hint={draft.date ? `${WEEKDAY[weekdayOf(draft.date)]}요일${inSem ? '' : ', 학기 기간 밖'}` : undefined}>
          <input type="date" className={inputCls} value={draft.date ?? ''} onChange={(e) => set({ date: e.target.value })} />
        </Field>
        {t === 'add' && (
          <Field label="강의실">
            <select className={inputCls} value={draft.room ?? ''} onChange={(e) => set({ room: e.target.value })}>
              <option value="">선택</option>
              {ROOM_ORDER.map((r) => (
                <option key={r} value={r}>
                  {r}호 ({meta?.rooms[r]?.type_label}, {meta?.rooms[r]?.capacity}명)
                </option>
              ))}
            </select>
          </Field>
        )}
        {(t === 'cancel' || t === 'move') && (
          <Field label="대상 강의" className={compact ? 'col-span-2' : 'col-span-1'}>
            <select className={inputCls} value={draft.course_id ?? ''} onChange={(e) => set({ course_id: e.target.value })}>
              <option value="">{wd != null ? `${WEEKDAY[wd]}요일 강의 선택` : '날짜 먼저 선택'}</option>
              {dayCourses.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.room} {c.start} {c.class_name}
                </option>
              ))}
            </select>
          </Field>
        )}
        {t === 'move' && (
          <Field label="바꿀 강의실">
            <select className={inputCls} value={draft.new_room ?? ''} onChange={(e) => set({ new_room: e.target.value })}>
              <option value="">선택</option>
              {ROOM_ORDER.map((r) => (
                <option key={r} value={r}>
                  {r}호
                </option>
              ))}
            </select>
          </Field>
        )}
        {t === 'add' && (
          <>
            <Field label="시작">
              <input type="time" step={300} className={inputCls} value={draft.start ?? ''} onChange={(e) => set({ start: e.target.value })} />
            </Field>
            <Field label="종료">
              <input type="time" step={300} className={inputCls} value={draft.end ?? ''} onChange={(e) => set({ end: e.target.value })} />
            </Field>
            <Field label="예상 인원" hint={over ? `정원 ${room?.capacity}명 초과` : room ? `정원 ${room.capacity}명` : undefined}>
              <input
                type="number"
                min={0}
                className={cx(inputCls, over && 'border-crit')}
                value={draft.expected_people ?? ''}
                onChange={(e) => set({ expected_people: e.target.value === '' ? null : Number(e.target.value) })}
              />
            </Field>
          </>
        )}
        {t !== 'cancel' && (
          <Field label={t === 'closure' ? '사유' : '제목'} className={compact ? 'col-span-2' : 'col-span-3'}>
            <input className={inputCls} value={draft.title ?? ''} onChange={(e) => set({ title: e.target.value })} placeholder={t === 'closure' ? '예: 정전 점검' : '예: 졸업작품 발표'} />
          </Field>
        )}
      </div>
      <EventCheckPanel draft={draft} result={checked} compact={compact} onPickRoom={(r) => set(t === 'move' ? { new_room: r } : { room: r })} />
      <div className="flex flex-wrap items-center justify-end gap-2 border-t border-line pt-3">
        {checked.check && !checked.check.ok && !checked.checking && (
          <span className="mr-auto text-[12.5px] text-crit-ink">위 문제를 고치거나, 알고도 등록할 수 있습니다.</span>
        )}
        {onCancel && (
          <Button variant="ghost" onClick={onCancel}>
            취소
          </Button>
        )}
        <Button
          variant={checked.check && !checked.check.ok ? 'danger' : 'primary'}
          onClick={onSave}
          disabled={!valid || saving || checked.checking}
          title={checked.checking ? '겹치는 일정을 확인한 뒤 등록할 수 있습니다' : undefined}
        >
          {saving ? <Spinner className={checked.check && !checked.check.ok ? '' : 'text-white'} /> : <CheckCircle2 size={14} />}
          {checked.check && !checked.check.ok ? '문제를 알고 등록' : '등록하고 다시 계산'}
        </Button>
      </div>
    </div>
  )
}

export function BeforeAfter({ r }: { r: EventResult }) {
  const b = r.before
  const a = r.after
  const keys: StrategyKey[] = ['ai', 'rule', 'manual', 'fixed']
  return (
    <div className="fade-in space-y-3">
      <div className="flex items-center gap-2 rounded-[6px] bg-good-bg px-3 py-2 text-[12.5px] text-good-ink">
        <CheckCircle2 size={14} />
        <span>
          <b>{fmtDateK(r.event.date)}</b> {r.event.room ? `${r.event.room}호 ` : ''}
          {r.event.title}
          {r.event.title?.includes(EVENT_TYPE[r.event.type] ?? '') ? '' : ` (${EVENT_TYPE[r.event.type]})`}을 등록하고 그날 운전 계획을 다시 만들었습니다.
        </span>
      </div>
      <div className="grid grid-cols-3 gap-2">
        <CmpCell label="강의·일정" before={`${b.sessions}건`} after={`${a.sessions}건`} changed={a.sessions !== b.sessions} />
        <CmpCell label="AI 전력량" before={`${fmtKwh(b.strategies.ai.kwh)}`} after={`${fmtKwh(a.strategies.ai.kwh)} kWh`} changed />
        <CmpCell label="AI 쾌적" before={fmtPct(b.strategies.ai.comfort_pct)} after={fmtPct(a.strategies.ai.comfort_pct)} changed={b.strategies.ai.comfort_pct !== a.strategies.ai.comfort_pct} />
      </div>
      <table className="tnum w-full text-[13px]">
        <thead className="text-[12px] text-ink-3">
          <tr>
            <th className="py-1.5 text-left font-medium">운전 방식</th>
            <th className="py-1.5 text-right font-medium">등록 전</th>
            <th className="py-1.5 text-right font-medium">등록 후</th>
            <th className="py-1.5 text-right font-medium">변화</th>
          </tr>
        </thead>
        <tbody>
          {keys.map((k) => {
            const d = a.strategies[k].kwh - b.strategies[k].kwh
            return (
              <tr key={k} className="border-t border-line">
                <td className="py-1.5">
                  <StrategyName k={k} />
                </td>
                <td className="py-1.5 text-right text-ink-2">{fmtKwh(b.strategies[k].kwh)} kWh</td>
                <td className="py-1.5 text-right font-medium">{fmtKwh(a.strategies[k].kwh)} kWh</td>
                <td className={cx('py-1.5 text-right font-semibold', d > 0.005 ? 'text-crit-ink' : d < -0.005 ? 'text-good-ink' : 'text-ink-3')}>
                  {d > 0 ? '+' : d < 0 ? '−' : ''}
                  {fmtKwh(Math.abs(d))}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
      <p className="text-[12px] text-ink-3">
        같은 일정이 생겨도 AI 예측 제어는 {STRATEGY.fixed.label}보다 {fmtKwh(a.strategies.fixed.kwh - a.strategies.ai.kwh)} kWh 적게 씁니다.
      </p>
    </div>
  )
}

function CmpCell({ label, before, after, changed }: { label: string; before: string; after: string; changed?: boolean }) {
  return (
    <div className="rounded-[6px] border border-line px-3 py-2">
      <div className="text-[12px] text-ink-3">{label}</div>
      <div className="tnum mt-0.5 flex items-baseline gap-1.5 text-[13px]">
        <span className="text-ink-3 line-through decoration-ink-4">{before}</span>
        <ArrowRight size={11} className="text-ink-3" />
        <span className={cx('font-semibold', changed ? 'text-ink' : 'text-ink-2')}>{after}</span>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------- audit

function AuditTab() {
  const audit = useApi<AuditRec[]>('/api/audit?limit=200')
  const kindLabel: Record<string, { label: string; tone: 'event' | 'info' | 'brand' | 'neutral' }> = {
    event: { label: '이벤트', tone: 'event' },
    settings: { label: '운영 규칙', tone: 'info' },
    import: { label: '시간표', tone: 'neutral' },
  }
  return (
    <Card>
      <CardHeader title="변경 기록" sub="운전 계획에 영향을 주는 입력을 누가, 언제, 무엇으로 바꿨는지 남깁니다." right={<Button size="sm" onClick={audit.reload}>새로고침</Button>} />
      {audit.error ? (
        <ErrorBox error={audit.error} onRetry={audit.reload} />
      ) : !audit.data ? (
        <Loading />
      ) : audit.data.length === 0 ? (
        <Empty title="아직 변경 기록이 없습니다" desc="이벤트 등록, 시간표 반영, 운영 규칙 변경이 생기면 여기에 시간순으로 남습니다." icon={<History size={17} />} />
      ) : (
        <ol className="relative ml-2 border-l border-line">
          {audit.data.map((a) => {
            const k = kindLabel[a.kind] ?? { label: a.kind, tone: 'neutral' as const }
            return (
              <li key={a.id} className="relative py-2.5 pl-5">
                <span className="absolute top-4 -left-[5px] h-2.5 w-2.5 rounded-full border-2 border-surface bg-ink-3" aria-hidden />
                <div className="flex flex-wrap items-center gap-2 text-[12.5px] text-ink-3">
                  <span className="tnum font-medium text-ink-2">{fmtTs(a.ts)}</span>
                  <Badge tone={k.tone}>{k.label}</Badge>
                  <span>{a.actor}</span>
                </div>
                <div className="mt-0.5 text-[13px] text-ink">{a.message}</div>
              </li>
            )
          })}
        </ol>
      )}
    </Card>
  )
}
