import { flushSync } from 'react-dom'

type Transition = { finished: Promise<void>; ready: Promise<void> }
type TransitionDocument = Document & { startViewTransition?: (update: () => void) => Transition }
let navigating = false

/** An HTML snapshot avoids depending on browsers capturing an SVG <g> directly. */
function tileSnapshot(room: string): HTMLDivElement | null {
  const tile = document.querySelector<SVGGElement>(`[data-room="${CSS.escape(room)}"]`)
  const svg = tile?.ownerSVGElement
  if (!tile || !svg || !tile.getClientRects().length) return null
  const rect = tile.getBoundingClientRect()
  const box = tile.getBBox()
  if (!rect.width || !rect.height || !box.width || !box.height) return null
  const layer = document.createElement('div')
  layer.setAttribute('aria-hidden', 'true')
  Object.assign(layer.style, {
    position: 'fixed', left: `${rect.left}px`, top: `${rect.top}px`,
    width: `${rect.width}px`, height: `${rect.height}px`, pointerEvents: 'none',
    zIndex: '35', fontFamily: getComputedStyle(tile).fontFamily,
  })
  layer.style.setProperty('view-transition-name', 'thermo-room-focus')
  const picture = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  picture.setAttribute('viewBox', `${box.x} ${box.y} ${box.width} ${box.height}`)
  picture.setAttribute('width', '100%')
  picture.setAttribute('height', '100%')
  picture.style.overflow = 'visible'
  const defs = svg.querySelector('defs')
  if (defs) picture.append(defs.cloneNode(true))
  const copy = tile.cloneNode(true) as SVGGElement
  copy.removeAttribute('tabindex')
  copy.removeAttribute('role')
  copy.removeAttribute('data-room')
  copy.removeAttribute('class')
  picture.append(copy)
  // Snapshot definitions are independent from the hidden original drawing.
  const ids = new Map<string, string>()
  picture.querySelectorAll('[id]').forEach((node) => {
    const old = node.id
    const next = `tp-snapshot-${old}`
    ids.set(old, next)
    node.id = next
  })
  picture.querySelectorAll('*').forEach((node) => {
    for (const attr of Array.from(node.attributes)) {
      let value = attr.value
      ids.forEach((next, old) => { value = value.split(`url(#${old})`).join(`url(#${next})`) })
      if (value !== attr.value) node.setAttribute(attr.name, value)
    }
  })
  layer.append(picture)
  document.body.append(layer)
  return layer
}

/** Shared tile zoom when supported; immediate navigation and a CSS entry otherwise. */
export function transitionRoom(update: () => void, afterUpdate?: () => void, room?: string) {
  if (navigating) return
  const doc = document as TransitionDocument
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
  const commit = () => { flushSync(update); afterUpdate?.() }
  if (!doc.startViewTransition || reduced) { commit(); return }

  let snapshot: HTMLDivElement | null = null
  try { snapshot = room ? tileSnapshot(room) : null } catch { /* normal page transition remains available */ }
  const entering = snapshot != null
  let committed = false
  navigating = true
  document.documentElement.classList.add('tp-transitioning')
  const cleanup = () => {
    snapshot?.remove()
    document.documentElement.classList.remove('tp-transitioning')
    navigating = false
  }
  try {
    const transition = doc.startViewTransition(() => {
      snapshot?.remove()
      snapshot = null
      committed = true
      commit()
      if (!entering && room) {
        try { snapshot = tileSnapshot(room) } catch { /* no destination snapshot */ }
      }
    })
    // A skipped/unsupported transition must never become an unhandled rejection.
    void transition.ready.catch(() => undefined)
    void transition.finished.catch(() => undefined).finally(cleanup)
  } catch {
    cleanup()
    if (!committed) commit()
  }
}
