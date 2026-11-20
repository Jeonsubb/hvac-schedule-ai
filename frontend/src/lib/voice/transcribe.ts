import { audioEvent, decodeMessage, payloadJson } from './eventstream'

/**
 * Amazon Transcribe streaming over a presigned WebSocket (the URL is signed by the backend with the
 * Lambda role; no AWS credentials reach the browser). Feed 16 kHz mono 16-bit PCM, receive Korean text.
 */
export interface SttHandlers {
  /** text so far: finished segments + the segment being spoken */
  onText: (text: string, isFinal: boolean) => void
  onError: (message: string) => void
  onClose?: () => void
}

interface TranscriptEvent {
  Transcript?: { Results?: { IsPartial?: boolean; Alternatives?: { Transcript?: string }[] }[] }
  Message?: string
}

export class TranscribeStream {
  private ws: WebSocket
  private queue: Uint8Array[] = []
  private done = ''
  private closed = false
  ready: Promise<void>

  constructor(url: string, h: SttHandlers) {
    this.ws = new WebSocket(url)
    this.ws.binaryType = 'arraybuffer'
    this.ready = new Promise((resolve, reject) => {
      this.ws.onopen = () => {
        for (const q of this.queue) this.ws.send(audioEvent(q))
        this.queue = []
        resolve()
      }
      this.ws.onerror = () => {
        reject(new Error('음성 인식 서버에 연결하지 못했습니다.'))
        if (!this.closed) h.onError('음성 인식 서버에 연결하지 못했습니다.')
      }
    })
    this.ready.catch(() => {})
    this.ws.onmessage = (ev) => {
      const m = decodeMessage(ev.data as ArrayBuffer)
      const body = payloadJson<TranscriptEvent>(m)
      if (m.headers[':message-type'] === 'exception') {
        h.onError(body?.Message ?? m.headers[':exception-type'] ?? '음성 인식 오류')
        return
      }
      const results = body?.Transcript?.Results ?? []
      for (const r of results) {
        const text = r.Alternatives?.[0]?.Transcript ?? ''
        if (r.IsPartial) h.onText((this.done + ' ' + text).trim(), false)
        else {
          this.done = (this.done + ' ' + text).trim()
          h.onText(this.done, true)
        }
      }
    }
    this.ws.onclose = () => {
      this.closed = true
      h.onClose?.()
    }
  }

  /** 16-bit little-endian PCM bytes */
  send(pcm: Uint8Array) {
    if (this.closed || !pcm.length) return
    if (this.ws.readyState === WebSocket.OPEN) this.ws.send(audioEvent(pcm))
    else if (this.ws.readyState === WebSocket.CONNECTING && this.queue.length < 200) this.queue.push(pcm)
  }

  /** tell the service the utterance is over; it flushes the last result and closes */
  end() {
    if (this.ws.readyState === WebSocket.OPEN) this.ws.send(audioEvent(new Uint8Array(0)))
  }

  close() {
    this.closed = true
    try {
      this.end()
      this.ws.close()
    } catch {
      /* already closed */
    }
  }
}
