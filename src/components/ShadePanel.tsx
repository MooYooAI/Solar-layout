import type { Obstacle } from '../lib/shading'
import type { MapTool } from './MapView'
import { rad2deg } from '../lib/geo'
import { sunPosition, type SunPos } from '../lib/sun'
import { horizonAt, type Horizon } from '../lib/horizon'

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
  horizon: Horizon | null
  horizonError: string | null
  horizonLoading: boolean
  horizonOn: boolean
  onHorizonOn: (on: boolean) => void
  /** 지금 해가 산 뒤에 있는지 */
  terrainBlocked: boolean
  /** 고른 날의 태양 적위(도) */
  decl: number
  lat: number | null
  /** 고른 날의 일출·일몰(KST)과 주변 산을 넘는 시각. 산 자료가 없으면 terrain은 null. */
  sunTimes: { rise: number; set: number; terrain: { rise: number; set: number } | null } | null
}

const pct = (x: number) => `${(x * 100).toFixed(1)} %`
const hhmm = (h: number) => {
  const m = Math.round(h * 60)
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
}
/** 시간 길이(시) → "9시간 50분" */
const hm = (h: number) => {
  const m = Math.max(0, Math.round(h * 60))
  return m >= 60 ? `${Math.floor(m / 60)}시간 ${m % 60}분` : `${m}분`
}

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
        {props.sunTimes && (
          <dl className="facts sun-times">
            <dt>일출·일몰</dt>
            <dd>
              {hhmm(props.sunTimes.rise)} ~ {hhmm(props.sunTimes.set)}
              <small> 낮 {hm(props.sunTimes.set - props.sunTimes.rise)}</small>
            </dd>
            {props.horizonOn && props.sunTimes.terrain && (
              <>
                <dt>실제 일조</dt>
                <dd>
                  {hhmm(props.sunTimes.terrain.rise)} ~ {hhmm(props.sunTimes.terrain.set)}
                  <small> 주변 산에 가려 {hm(props.sunTimes.terrain.rise - props.sunTimes.rise + props.sunTimes.set - props.sunTimes.terrain.set)} 짧음</small>
                </dd>
              </>
            )}
          </dl>
        )}
      </section>

      <section className="card">
        <h2>음영 결과</h2>
        {props.hasSets ? (
          <dl className="facts">
            <dt>지금</dt>
            <dd>{props.terrainBlocked ? '해가 주변 산에 가려 부지 전체가 그늘' : `모듈의 ${pct(props.currentShade)}가 그늘`}</dd>
            <dt>이 날 하루</dt>
            <dd>{props.dailyLoss === null ? '계산 중…' : `직달 일사 약 ${pct(props.dailyLoss)} 손실`}</dd>
          </dl>
        ) : (
          <p className="hint">AI 설계 단계에서 모듈을 먼저 배치하세요.</p>
        )}
        <p className="hint">
          그늘진 세트는 빨갛게, 그림자는 어둡게 표시됩니다. 3D 지도에서는 모듈 판 위에 진 그림자를 검게 칠해 정면·측면에서도 보입니다. 하루 손실과 발전량에는 모듈 열끼리의 그림자, 아래에 그린 장애물,
          {props.horizonOn && props.horizon ? ' 주변 산(지형)' : ''} 그늘이 들어갑니다.
        </p>
      </section>

      <section className="card">
        <h2>주변 지형(산) 그늘</h2>
        <label className="row">
          <input type="checkbox" checked={props.horizonOn} onChange={(e) => props.onHorizonOn(e.target.checked)} /> 음영·발전량 계산에 반영
        </label>
        {props.horizonLoading ? (
          <p className="hint">반경 5 km 표고를 받아 지평선을 계산하는 중…</p>
        ) : props.horizonError ? (
          <p className="error">표고를 받지 못해 지형 그늘을 빼고 계산합니다. ({props.horizonError})</p>
        ) : props.horizon ? (
          <HorizonChart horizon={props.horizon} decl={props.decl} lat={props.lat} sun={sun} dim={!props.horizonOn} />
        ) : (
          <p className="hint">필지를 고르면 주변 지형을 불러옵니다.</p>
        )}
        <p className="hint">
          부지 중심에서 방위마다 5 km까지 가장 높이 솟은 지형의 각도입니다(약 30 m 해상도 표고, 지구 곡률 보정). 해가 이 선보다 낮으면
          부지 전체를 그늘로 봅니다. 건물 높이 자료는 없으므로 가까운 건물·나무는 아래에서 직접 그려 넣으세요.
        </p>
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

/** 지평선(산 높이각)과 고른 날의 해 길 */
function HorizonChart(props: { horizon: Horizon; decl: number; lat: number | null; sun: SunPos | null; dim: boolean }) {
  const { horizon: h } = props
  const W = 300
  const H = 120
  const A0 = -135 // 동남동 쪽부터
  const A1 = 135
  const terrainMax = Math.max(...h.angles)
  // 해 길(고른 날)을 먼저 구해 세로 축이 지형과 해 길을 모두 담게 한다.
  const sunPts: Array<[number, number]> = []
  if (props.lat !== null)
    for (let t = 4; t <= 20; t += 0.25) {
      const s = sunPosition(props.lat, props.decl, t)
      const az = rad2deg(s.azimuth)
      if (s.altitude > 0 && az >= A0 && az <= A1) sunPts.push([az, rad2deg(s.altitude)])
    }
  const top = Math.ceil((Math.max(terrainMax, ...sunPts.map((q) => q[1]), 15) + 5) / 10) * 10
  const x = (az: number) => ((az - A0) / (A1 - A0)) * W
  const y = (alt: number) => H - (Math.max(0, alt) / top) * H
  const terrain: string[] = [`0,${H}`]
  for (let az = A0; az <= A1; az += 1) terrain.push(`${x(az).toFixed(1)},${y(rad2deg(horizonAt(h, deg2radLocal(az)))).toFixed(1)}`)
  terrain.push(`${W},${H}`)
  const path = sunPts.map(([az, alt]) => `${x(az).toFixed(1)},${y(alt).toFixed(1)}`)
  const sunAz = props.sun ? rad2deg(props.sun.azimuth) : NaN
  const sunAlt = props.sun ? rad2deg(props.sun.altitude) : NaN
  const worst = h.angles.reduce((m, a, i) => (a > h.angles[m] ? i : m), 0)
  return (
    <figure className={props.dim ? 'horizon dim' : 'horizon'}>
      <svg viewBox={`0 -14 ${W} ${H + 30}`} role="img" aria-label="방위별 주변 지형 높이각과 해의 길">
        {[10, 20, 30, 40, 50, 60, 70, 80].filter((a) => a < top && (top <= 40 || a % 20 === 0)).map((a) => (
          <g key={a}>
            <line className="grid" x1={0} x2={W} y1={y(a)} y2={y(a)} />
            <text className="tick" x={2} y={y(a) - 2}>
              {a}°
            </text>
          </g>
        ))}
        <polygon className="terrain" points={terrain.join(' ')} />
        {path.length > 1 && <polyline className="sunpath" points={path.join(' ')} />}
        {props.sun && props.sun.altitude > 0 && sunAz >= A0 && sunAz <= A1 && <circle className="sun" cx={x(sunAz)} cy={y(sunAlt)} r={4.5} />}
        <line className="axis" x1={0} x2={W} y1={H} y2={H} />
        {[
          [-90, '동'],
          [-45, '남동'],
          [0, '남'],
          [45, '남서'],
          [90, '서'],
        ].map(([az, label]) => (
          <text key={label} className="tick" x={x(az as number)} y={H + 13} textAnchor="middle">
            {label}
          </text>
        ))}
      </svg>
      <figcaption>
        가장 높은 곳 {terrainMax.toFixed(1)}° ({compass(-180 + worst * h.step)} 방향) · 부지 표고 {Math.round(h.siteElevation)} m
      </figcaption>
    </figure>
  )
}

const deg2radLocal = (d: number) => (d * Math.PI) / 180

/** 방위(남 0·서 +)를 8방위 이름으로 */
function compass(az: number) {
  const bearing = (((180 + az) % 360) + 360) % 360
  return ['북', '북동', '동', '남동', '남', '남서', '서', '북서'][Math.round(bearing / 45) % 8]
}
