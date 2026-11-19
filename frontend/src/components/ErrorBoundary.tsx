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
        <div className="mx-auto max-w-[560px] rounded-[10px] border border-[#efc6c6] bg-surface p-5">
          <div className="flex items-start gap-3">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-crit-bg text-crit" aria-hidden>
              <AlertTriangle size={17} />
            </span>
            <div className="min-w-0">
              <div className="text-[15px] font-[650] text-ink">
                {this.props.area}
                {objectParticle(this.props.area)} 표시하지 못했습니다
              </div>
              <p className="mt-1 text-[13px] leading-relaxed text-ink-2">
                서버에서 받은 데이터 중 화면이 예상하지 못한 값이 있습니다. 다시 시도해도 같으면 다른 화면으로 이동했다가 돌아오거나 새로고침하세요.
              </p>
              <p className="mt-2 rounded-[6px] bg-well px-2.5 py-1.5 text-[12px] break-all text-ink-3 ring-1 ring-line ring-inset">{error.message || String(error)}</p>
              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  className="inline-flex h-8 items-center gap-1.5 rounded-[6px] bg-ink px-3 text-[13px] font-medium text-white hover:bg-[#24334d]"
                  onClick={() => this.setState({ error: null })}
                >
                  <RotateCw size={13} /> 다시 시도
                </button>
                <button
                  className="inline-flex h-8 items-center rounded-[6px] border border-line-strong bg-surface px-3 text-[13px] font-medium text-ink hover:bg-hover"
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
