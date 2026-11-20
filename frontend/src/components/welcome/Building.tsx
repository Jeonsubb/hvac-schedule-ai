import { FOCUS, SLOTS, type Slot } from './data'

/**
 * Schematic IT관 massing built from CSS 3D planes (no 3D library).
 * Floors are stacked planes that the welcome timeline can pull apart (z), slice open
 * (facade clip-path) and light (room/window opacity). 3F and 4F carry the ten real rooms;
 * the other floors are plain massing. Only leaf elements ever get opacity or clip-path,
 * because either property on a preserve-3d container would flatten the scene.
 */

export const BW = 780 // footprint width (px)
export const BD = 300 // footprint depth
export const FH = 58 // floor-to-floor height
export const FLOORS = [1, 2, 3, 4, 5] as const

const GAP = 8
const ROOM_Y = 112 // rooms sit at the front, corridor and service zone behind
const CORR_Y = 64

function place(slots: Slot[]) {
  const unit = (BW - 24 - GAP * (slots.length - 1)) / slots.reduce((a, s) => a + s.w, 0)
  let acc = 12
  return slots.map((s) => {
    const x = acc
    const w = s.w * unit
    acc = x + w + GAP
    return { ...s, x, w }
  })
}

function Plan({ floor }: { floor: 3 | 4 }) {
  return (
    <>
      <div className="ond-zone" style={{ left: 12, top: 12, width: BW - 24, height: CORR_Y - 20 }} />
      <div className="ond-corridor" style={{ left: 12, top: CORR_Y, width: BW - 24, height: ROOM_Y - CORR_Y - GAP }}>
        <span>{floor}F 복도</span>
      </div>
      {place(SLOTS[floor]).map((s) =>
        s.room ? (
          <div
            key={s.room}
            className="ond-room"
            data-room={s.room}
            data-focus={FOCUS[s.room] ? '1' : undefined}
            style={{ left: s.x, top: ROOM_Y, width: s.w, height: BD - ROOM_Y - 12 }}
          >
            <span className="ond-room-heat" />
            <span className="ond-room-num">{s.room}</span>
            {FOCUS[s.room] && <span className="ond-room-class">{FOCUS[s.room]}</span>}
          </div>
        ) : (
          <div key={s.label} className="ond-space" style={{ left: s.x, top: ROOM_Y, width: s.w, height: BD - ROOM_Y - 12 }}>
            <span>{s.label}</span>
          </div>
        ),
      )}
    </>
  )
}

function Facade({ floor }: { floor: number }) {
  const detailed = floor === 3 || floor === 4
  const slots = detailed ? place(SLOTS[floor as 3 | 4]) : place([{ w: 1 }, { w: 1 }, { w: 1 }, { w: 1 }, { w: 1 }, { w: 0.92 }, { w: 0.74 }])
  return (
    <div className="ond-fac ond-fac-front ond-leaf" data-floor={floor}>
      {slots.map((s, i) => (
        <span key={i} className="ond-win" style={{ left: s.x, width: s.w }}>
          {s.room && FOCUS[s.room] && <span className="ond-win-lit" data-room={s.room} />}
        </span>
      ))}
    </div>
  )
}

export default function Building() {
  return (
    <div className="ond-bfit" aria-hidden>
      <div className="ond-bcam">
        <div className="ond-bspin">
          <div className="ond-ground" />
          {FLOORS.map((f) => (
            <div key={f} className="ond-fl" data-floor={f}>
              <div className={`ond-slab ond-leaf${f === 3 || f === 4 ? ' is-plan' : ''}`} data-floor={f}>
                {(f === 3 || f === 4) && <Plan floor={f} />}
                <span className="ond-slab-tag">{f}F</span>
              </div>
              <Facade floor={f} />
              <div className="ond-fac ond-fac-side ond-leaf" data-floor={f} />
              {f === 5 && <div className="ond-roof ond-leaf" data-floor={f} />}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
