import type { Obstacle } from '../lib/shading'
import type { MapTool } from './MapView'
import { rad2deg } from '../lib/geo'
import type { SunPos } from '../lib/sun'

const SEASONS = [
  { label: '동지', month: 12, day: 22 },
  { label: '춘분', month: 3, day: 21 },
  { label: '하지', month: 6, day: 21 },
  { label: '추분', month: 9, day: 23 },
]

interface Props {
  month: number
  day: number
  hour: number
  onDate: (month: number, day: number) => void
  onHour: (h: number) => void
  playing: boolean
  onPlay: (on: boolean) => void
  sun: SunPos | null
  currentShade: number
  dailyLoss: number | null
  hasSets: boolean
  obstacles: Obstacle[]
  onObstacles: (o: Obstacle[]) => void
  tool: MapTool
  onTool: (t: MapTool) => void
}

const pct = (x: number) => `${(x * 100).toFixed(1)} %`
const hhmm = (h: number) => `${String(Math.floor(h)).padStart(2, '0')}:${String(Math.round((h % 1) * 60)).padStart(2, '0')}`

export default function ShadePanel(props: Props) {
  const { month, day, hour, sun, obstacles, onObstacles } = props
  const below = !sun || sun.altitude <= 0

  return (
    <>
      <section className="card">
        <h2>날짜와 시각</h2>
        <div className="row">
          {SEASONS.map((s) => (
            <button
              key={s.label}
              type="button"
              className={s.month === month && s.day === day ? '' : 'secondary'}
              onClick={() => props.onDate(s.month, s.day)}
            >
              {s.label}
            </button>
          ))}
        </div>
        <div className="grid2" style={{ marginTop: 10 }}>
          <label className="field">
            <span>월</span>
            <input type="number" min={1} max={12} value={month} onChange={(e) => props.onDate(clamp(e.target.valueAsNumber, 1, 12), day)} />
          </label>
          <label className="field">
            <span>일</span>
            <input type="number" min={1} max={31} value={day} onChange={(e) => props.onDate(month, clamp(e.target.valueAsNumber, 1, 31))} />
          </label>
        </div>
        <div className="time-row">
          <button type="button" className="secondary" onClick={() => props.onPlay(!props.playing)}>
            {props.playing ? '■' : '▶'}
          </button>
          <input
            type="range"
            min={5}
            max={20}
            step={0.25}
            value={hour}
            onChange={(e) => props.onHour(e.target.valueAsNumber)}
          />
          <strong>{hhmm(hour)}</strong>
        </div>
        <p className="hint">
          {below
            ? '해가 진 시각입니다.'
            : `태양 고도 ${rad2deg(sun!.altitude).toFixed(1)}°, 방위 ${azLabel(rad2deg(sun!.azimuth))}`}{' '}
          (한국 표준시)
        </p>
      </section>

      <section className="card">
        <h2>음영 결과</h2>
        {props.hasSets ? (
          <dl className="facts">
            <dt>지금</dt>
            <dd>모듈의 {pct(props.currentShade)}가 그늘</dd>
            <dt>이 날 하루</dt>
            <dd>{props.dailyLoss === null ? '계산 중…' : `직달 일사 약 ${pct(props.dailyLoss)} 손실`}</dd>
          </dl>
        ) : (
          <p className="hint">배치 탭에서 모듈을 먼저 배치하세요.</p>
        )}
        <p className="hint">그늘진 세트는 빨갛게, 그림자는 어둡게 표시됩니다.</p>
      </section>

      <section className="card">
        <h2>주변 장애물</h2>
        <button
          type="button"
          className={props.tool === 'obstacle' ? '' : 'secondary'}
          onClick={() => props.onTool(props.tool === 'obstacle' ? 'none' : 'obstacle')}
        >
          {props.tool === 'obstacle' ? '그리기 취소' : '건물·나무 그리기'}
        </button>
        {props.tool === 'obstacle' && <p className="hint">지도에서 바닥 윤곽을 찍고 첫 점을 다시 클릭하면 끝납니다.</p>}
        {obstacles.length > 0 && (
          <ul className="obstacles">
            {obstacles.map((o) => (
              <li key={o.id}>
                <input
                  value={o.name}
                  onChange={(e) => onObstacles(obstacles.map((x) => (x.id === o.id ? { ...x, name: e.target.value } : x)))}
                />
                <label className="field inline">
                  <input
                    type="number"
                    min={0}
                    step={0.5}
                    value={o.height}
                    onChange={(e) => {
                      const v = e.target.valueAsNumber
                      if (!Number.isNaN(v)) onObstacles(obstacles.map((x) => (x.id === o.id ? { ...x, height: v } : x)))
                    }}
                  />
                  <em>m</em>
                </label>
                <button type="button" className="secondary" onClick={() => onObstacles(obstacles.filter((x) => x.id !== o.id))}>
                  삭제
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  )
}

function clamp(v: number, lo: number, hi: number) {
  return Number.isNaN(v) ? lo : Math.max(lo, Math.min(hi, Math.round(v)))
}

function azLabel(az: number) {
  if (Math.abs(az) < 1) return '정남'
  return az > 0 ? `남서 ${az.toFixed(0)}°` : `남동 ${(-az).toFixed(0)}°`
}
