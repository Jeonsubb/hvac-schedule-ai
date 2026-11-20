import { useEffect, useState } from 'react'
import { apiSend, useApi } from '../lib/api'
import { Badge, Button, Card, CardHeader, ErrorBox, Field, inputCls, toast } from './ui'

type Preferences = { enabled: boolean; approvals: boolean; checks: boolean; failures: boolean; completed: boolean }
type State = Preferences & { email_masked: string; status: 'disabled' | 'pending' | 'confirmed'; available: boolean }
const labels = { approvals: '운전 조정안 승인 요청', checks: '일정·온도 등 점검 필요 항목', failures: '시스템 작업 실패', completed: '일반 작업 완료' }
const pick = (s: State): Preferences =>
  ({ enabled: s.enabled, approvals: s.approvals, checks: s.checks, failures: s.failures, completed: s.completed })

export default function OperatorNotifications() {
  const [waiting, setWaiting] = useState(false)
  // While the confirmation mail is unanswered, ask again every 10 s so the status flips on its own.
  const q = useApi<State>('/api/building/notifications', { refreshMs: waiting ? 10_000 : undefined })
  const [form, setForm] = useState<Preferences>({ enabled: false, approvals: true, checks: true, failures: true, completed: false })
  const [dirty, setDirty] = useState(false)
  const [email, setEmail] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<Error | null>(null)
  useEffect(() => {
    if (!q.data) return
    setWaiting(q.data.status === 'pending')
    if (!dirty) setForm(pick(q.data))
  }, [q.data, dirty])
  const edit = (patch: Partial<Preferences>) => { setForm({ ...form, ...patch }); setDirty(true) }

  const save = async () => {
    const address = email.trim()
    setBusy(true); setError(null)
    try {
      const r = await apiSend<State>('PUT', '/api/building/notifications', { ...form, ...(address ? { email: address, enabled: true } : {}) })
      setEmail(''); setDirty(false); q.reload()
      toast(address ? `${r.email_masked}로 확인 메일을 보냈습니다. 메일의 확인 링크를 한 번 눌러 주세요.`
        : r.enabled ? '알림 설정을 저장했습니다.' : '이메일 알림을 껐습니다.')
    } catch (e) { setError(e as Error) } finally { setBusy(false) }
  }

  const d = q.data
  return <Card flat className="mb-6">
    <CardHeader title="건물 관리자 이메일 알림" sub="승인이 필요하거나 점검할 문제가 생기면 관리자에게 메일로 알려 드립니다." />
    {q.error && <ErrorBox error={q.error} onRetry={q.reload} />}
    {d && <>
      <div className="mb-4 flex flex-wrap items-center gap-2 text-sm text-ink-2">
        {!d.email_masked ? <span className="text-ink-3">등록된 이메일이 없습니다.</span> : <>
          <span>{d.email_masked}</span>
          {d.status === 'confirmed' && <Badge tone="good">수신 중</Badge>}
          {d.status === 'pending' && <><Badge tone="warn">확인 대기</Badge>
            <span className="text-ink-3">받은 메일의 확인 링크(Confirm subscription)를 누르면 이 화면이 자동으로 바뀝니다.</span></>}
          {d.status === 'disabled' && <Badge>꺼짐</Badge>}
        </>}
      </div>
      {!d.available && <p className="mb-4 text-sm text-ink-3">이메일 발송 서비스를 연결한 뒤 알림을 켤 수 있습니다.</p>}
      <Field label={d.email_masked ? '수신 주소 변경' : '관리자 이메일'} hint="저장하면 이 주소로 확인 메일이 한 번 갑니다. 링크를 누른 뒤부터 알림을 받습니다.">
        <input aria-label="관리자 이메일" type="email" className={inputCls} value={email} onChange={e => setEmail(e.target.value)} placeholder="manager@example.com" />
      </Field>
      {d.email_masked && <label className="mt-4 flex items-center gap-2 text-sm">
        <input type="checkbox" checked={form.enabled} onChange={e => edit({ enabled: e.target.checked })} />이메일 알림 받기</label>}
      <div className="my-4 grid gap-3 sm:grid-cols-2">{(Object.keys(labels) as (keyof typeof labels)[]).map(k =>
        <label key={k} className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={form[k]} onChange={e => edit({ [k]: e.target.checked })} />{labels[k]}</label>)}</div>
      {error && <ErrorBox error={error} />}
      <div className="flex justify-end">
        <Button variant="primary" disabled={busy || !d.available || (!email.trim() && !dirty) || (!email.trim() && !d.email_masked)} onClick={save}>
          {email.trim() ? '저장하고 확인 메일 받기' : '설정 저장'}</Button>
      </div>
    </>}
  </Card>
}
