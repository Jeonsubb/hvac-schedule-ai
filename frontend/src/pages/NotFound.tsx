import { Link } from 'react-router-dom'
import { MapPinOff } from 'lucide-react'
import { Empty, btnCls } from '../components/ui'

export default function NotFound() {
  return (
    <div className="py-20">
      <Empty
        icon={<MapPinOff size={17} />}
        title="없는 화면입니다"
        desc="주소가 바뀌었거나 잘못 입력되었습니다. 왼쪽 메뉴에서 화면을 고르거나 운영 현황으로 돌아가세요."
        action={
          <Link className={btnCls('primary')} to="/">
            운영 현황으로 가기
          </Link>
        }
      />
    </div>
  )
}
