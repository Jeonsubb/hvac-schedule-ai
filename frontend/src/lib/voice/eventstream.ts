/**
 * AWS event-stream framing (application/vnd.amazon.eventstream), the binary envelope Amazon Transcribe
 * streaming speaks over its WebSocket. Only what the browser needs: string headers and a byte payload.
 *
 *   [total length u32][headers length u32][prelude CRC32 u32][headers][payload][message CRC32 u32]
 */

const CRC_TABLE = (() => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c >>> 0
  }
  return t
})()

export function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

const enc = new TextEncoder()
const dec = new TextDecoder()

export function encodeMessage(headers: Record<string, string>, payload: Uint8Array): Uint8Array {
  const parts: Uint8Array[] = []
  let headersLen = 0
  for (const [name, value] of Object.entries(headers)) {
    const n = enc.encode(name)
    const v = enc.encode(value)
    const h = new Uint8Array(1 + n.length + 1 + 2 + v.length)
    h[0] = n.length
    h.set(n, 1)
    h[1 + n.length] = 7 // header value type: string
    h[2 + n.length] = v.length >> 8
    h[3 + n.length] = v.length & 0xff
    h.set(v, 4 + n.length)
    parts.push(h)
    headersLen += h.length
  }
  const total = 12 + headersLen + payload.length + 4
  const out = new Uint8Array(total)
  const view = new DataView(out.buffer)
  view.setUint32(0, total)
  view.setUint32(4, headersLen)
  view.setUint32(8, crc32(out.subarray(0, 8)))
  let off = 12
  for (const p of parts) {
    out.set(p, off)
    off += p.length
  }
  out.set(payload, off)
  view.setUint32(total - 4, crc32(out.subarray(0, total - 4)))
  return out
}

export interface DecodedMessage {
  headers: Record<string, string>
  payload: Uint8Array
}

export function decodeMessage(buf: ArrayBuffer | Uint8Array): DecodedMessage {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf)
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const total = view.getUint32(0)
  const headersLen = view.getUint32(4)
  const headers: Record<string, string> = {}
  let off = 12
  const end = 12 + headersLen
  while (off < end) {
    const nLen = bytes[off]
    const name = dec.decode(bytes.subarray(off + 1, off + 1 + nLen))
    off += 1 + nLen
    const type = bytes[off++]
    if (type === 7 || type === 6) {
      const vLen = view.getUint16(off)
      off += 2
      if (type === 7) headers[name] = dec.decode(bytes.subarray(off, off + vLen))
      off += vLen
    } else {
      // fixed-width types this service does not send to clients: bool, byte, short, int, long, timestamp, uuid
      off += [0, 0, 1, 2, 4, 8, 0, 0, 8, 16][type] ?? 0
    }
  }
  return { headers, payload: bytes.subarray(end, total - 4) }
}

/** One chunk of 16-bit PCM as a Transcribe AudioEvent; an empty chunk ends the stream. */
export function audioEvent(pcm: Uint8Array): Uint8Array {
  return encodeMessage({ ':content-type': 'application/octet-stream', ':event-type': 'AudioEvent', ':message-type': 'event' }, pcm)
}

export function payloadJson<T>(m: DecodedMessage): T | null {
  try {
    return JSON.parse(dec.decode(m.payload)) as T
  } catch {
    return null
  }
}
