import { Component, type ErrorInfo, type ReactNode } from 'react'
import { AlertTriangle, RotateCw } from 'lucide-react'

/** 을/를 by the last syllable's final consonant */
function objectParticle(word: string) {
  const c = word.charCodeAt(word.length - 1)
  if (c < 0xac00 || c > 0xd7a3) return '를'
  return (c - 0xac00) % 28 ? '을' : '를'
}

/**
 * Keeps one bad payload from blanking the app: the failing area shows what happened and how to recover,
 * the rest of the screen (sidebar, top bar, copilot) keeps working.
 */
export default class ErrorBoundary extends Component<{ children: ReactNode; area: string; compact?: boolean; wrapClassName?: string }, { error: Error | null }> {
  state: { error: Error | null } = { error: null }

  static getDerivedStateFromError(error: Error) {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(`[${this.props.area}]`, error, info.componentStack)
  }

  render() {
    const { error } = this.state
    if (!error) return this.props.children
    return (
      <div className={this.props.wrapClassName ?? (this.props.compact ? 'p-4' : 'py-10')} role="alert">
        <div className="mx-auto max-w-[560px] rounded-[16px] border border-[#efc6c6] bg-surface p-6">
          <div className="flex items-start gap-3">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-crit-bg text-crit" aria-hidden>
              <AlertTriangle size={17} />
            </span>
            <div className="min-w-0">
              <div className="text-[17px] font-[650] text-ink">
                {this.props.area}
                {objectParticle(this.props.area)} 표시하지 못했습니다
              </div>
              <p className="mt-1.5 text-[14px] leading-relaxed text-ink-2">
                서버에서 받은 데이터 중 화면이 예상하지 못한 값이 있습니다. 다시 시도해도 같으면 다른 화면으로 이동했다가 돌아오거나 새로고침하세요.
              </p>
              <p className="mt-3 rounded-[10px] bg-well px-3 py-2 text-[13px] break-all text-ink-3">{error.message || String(error)}</p>
              <div className="mt-4 flex flex-wrap gap-2">
                <button
                  type="button"
                  className="inline-flex h-10 items-center gap-2 rounded-[10px] bg-ink px-4 text-[14px] font-medium text-white transition-colors hover:bg-[#25344e]"
                  onClick={() => this.setState({ error: null })}
                >
                  <RotateCw size={14} aria-hidden /> 다시 시도
                </button>
                <button
                  type="button"
                  className="inline-flex h-10 items-center rounded-full border border-line-strong bg-surface px-5 text-[14px] font-medium text-ink transition-colors hover:bg-hover"
                  onClick={() => window.location.reload()}
                >
                  새로고침
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    )
  }
}
