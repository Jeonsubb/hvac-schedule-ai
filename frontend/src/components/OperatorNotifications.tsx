import { useEffect, useState } from 'react'
import { apiSend, useApi } from '../lib/api'
import { Button, Card, CardHeader, ErrorBox, Field, inputCls, toast } from './ui'

type Preferences = { enabled: boolean; approvals: boolean; checks: boolean; failures: boolean; completed: boolean }
type State = Preferences & { email_masked: string; status: string; available: boolean }
const labels = { approvals: '운전 조정안 승인 요청', checks: '일정·온도 등 점검 필요 항목', failures: '시스템 작업 실패', completed: '일반 작업 완료' }

export default function OperatorNotifications() {
  const q = useApi<State>('/api/building/notifications')
  const [form, setForm] = useState<Preferences>({ enabled: false, approvals: true, checks: true, failures: true, completed: false })
  const [email, setEmail] = useState('')
  const [key, setKey] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<Error | null>(null)
  useEffect(() => { if (q.data) setForm(q.data) }, [q.data])
  const run = async (verify = false) => {
    setBusy(true); setError(null)
    try {
      const result = await apiSend<State>(verify ? 'POST' : 'PUT', `/api/building/notifications${verify ? '/verify' : ''}`,
        verify ? undefined : { enabled: form.enabled, approvals: form.approvals, checks: form.checks,
          failures: form.failures, completed: form.completed, ...(email.trim() ? { email: email.trim() } : {}) },
        { 'x-operator-key': key })
      setEmail(''); q.reload()
      toast(result.status === 'confirmed' ? '이메일 수신이 활성화되었습니다.' : result.status === 'pending'
        ? '이메일의 수신 확인 링크를 누른 뒤 인증 상태를 확인해 주세요.' : '알림 설정을 저장했습니다.')
    } catch (e) { setError(e as Error) } finally { setBusy(false) }
  }
  return <Card className="mb-6">
    <CardHeader title="건물 관리자 이메일 알림" sub="승인이 필요하거나 점검할 문제가 생기면 이 건물의 관리자에게 알려드립니다." />
    {q.error && <ErrorBox error={q.error} onRetry={q.reload} />}
    {q.data && <>
      <p className="mb-4 text-sm text-ink-3">{q.data.email_masked || '등록된 이메일 없음'} · {q.data.status === 'confirmed' ? '수신 확인 완료' : q.data.status === 'pending' ? '이메일 수신 확인 대기' : '알림 꺼짐'}</p>
      {!q.data.available && <p className="mb-4 text-sm text-ink-3">이메일 발송 서비스를 연결한 뒤 알림을 켤 수 있습니다.</p>}
      <div className="grid gap-4 md:grid-cols-2">
        <Field label="운영자 이메일" hint="새 주소를 등록하거나 변경할 때 입력하세요.">
          <input aria-label="운영자 이메일" type="email" className={inputCls} value={email} onChange={e => setEmail(e.target.value)} placeholder="manager@example.com" />
        </Field>
        <Field label="운영자 키" hint="수신자 변경 권한을 확인합니다. 브라우저에 저장하지 않습니다.">
          <input aria-label="운영자 키" type="password" autoComplete="off" className={inputCls} value={key} onChange={e => setKey(e.target.value)} />
        </Field>
      </div>
      <label className="mt-4 flex items-center gap-2 text-sm"><input type="checkbox" checked={form.enabled} onChange={e => setForm({ ...form, enabled: e.target.checked })} />이메일 알림 받기</label>
      <div className="my-4 grid gap-3 sm:grid-cols-2">{(Object.keys(labels) as (keyof typeof labels)[]).map(k =>
        <label key={k} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form[k]} onChange={e => setForm({ ...form, [k]: e.target.checked })} />{labels[k]}</label>)}</div>
      <p className="mb-4 text-sm text-ink-3">처음 등록하면 확인 메일이 발송됩니다. 메일의 확인 링크를 눌러야 알림을 받을 수 있습니다.</p>
      {error && <ErrorBox error={error} />}
      <div className="flex justify-end gap-2">
        <Button disabled={busy || !key || !q.data.available} onClick={() => run(true)}>인증 상태 확인</Button>
        <Button variant="primary" disabled={busy || !key || !q.data.available} onClick={() => run()}>알림 설정 저장</Button>
      </div>
    </>}
  </Card>
}
