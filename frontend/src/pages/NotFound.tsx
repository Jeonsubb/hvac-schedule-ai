import { Link } from 'react-router-dom'
import { Empty } from '../components/ui'

export default function NotFound() {
  return (
    <div className="py-20">
      <Empty title="페이지를 찾을 수 없습니다" desc={<Link className="text-brand underline" to="/">운영 현황으로 이동</Link>} />
    </div>
  )
}
