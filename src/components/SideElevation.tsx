import type { LayoutParams, SetGeometry } from '../lib/layout'
import { deg2rad } from '../lib/geo'

interface Props {
  params: LayoutParams
  geometry: SetGeometry
  /** 위도(도). 동지 정오 그림자 길이를 그린다. */
  lat: number
}

const fmt = (n: number, d = 2) => n.toLocaleString('ko-KR', { maximumFractionDigits: d })

/**
 * 측면도: 동쪽에서 본 앞뒤 두 열의 세트 단면. 경사각, 지상고, 상단 높이, 경사면 길이, 투영 깊이,
 * 열 사이 이격거리와 피치, 동지 정오 그림자를 치수로 적는다. 왼쪽이 남쪽(앞)이다.
 */
export default function SideElevation({ params: p, geometry: g, lat }: Props) {
  const W = 400
  const pad = 30
  // 왼쪽은 '지상고' 치수 글자가 잘리지 않게 넉넉히 둔다.
  const padL = 86
  const span = g.depth * 2 + p.rowSpacing
  const s = (W - padL - pad) / Math.max(span, 1)
  const H = Math.max(g.height * s, 60) + 170
  const groundY = H - 78
  const X = (m: number) => padL + m * s
  const Y = (m: number) => groundY - m * s

  const tilt = deg2rad(p.tilt)
  const across = (p.portrait ? p.moduleLength : p.moduleWidth) / 1000
  const gap = p.moduleGap / 1000
  // 동지 정오 태양고도
  const alt = 90 - lat - 23.44
  const tanAlt = Math.tan(deg2rad(Math.max(alt, 1)))
  const shadowTip = g.depth + (g.height - p.groundClearance) / tanAlt // 상단 그림자가 지상고 높이에 닿는 곳
  const backFront = g.depth + p.rowSpacing
  const margin = backFront - shadowTip

  const set = (x0: number, key: string) => {
    const legIn = Math.min(0.2, g.depth / 4)
    const zAt = (x: number) => p.groundClearance + (x - x0) * Math.tan(tilt)
    const mods = []
    for (let r = 0; r < p.setRows; r++) {
      const a = r * (across + gap)
      const b = a + across
      mods.push(
        <line
          key={r}
          x1={X(x0 + a * Math.cos(tilt))}
          y1={Y(p.groundClearance + a * Math.sin(tilt))}
          x2={X(x0 + b * Math.cos(tilt))}
          y2={Y(p.groundClearance + b * Math.sin(tilt))}
          className="se-module"
        />,
      )
    }
    return (
      <g key={key}>
        {[x0 + legIn, x0 + g.depth - legIn].map((x, i) => (
          <line key={i} x1={X(x)} y1={Y(0)} x2={X(x)} y2={Y(zAt(x))} className="se-post" />
        ))}
        <line x1={X(x0 + legIn)} y1={Y(zAt(x0 + legIn) - 0.08)} x2={X(x0 + g.depth - legIn)} y2={Y(zAt(x0 + g.depth - legIn) - 0.08)} className="se-rail" />
        {mods}
      </g>
    )
  }

  // 가로 치수선
  const dimH = (x1: number, x2: number, y: number, label: string, key: string) => (
    <g key={key} className="se-dim">
      <line x1={X(x1)} y1={y} x2={X(x2)} y2={y} />
      <line x1={X(x1)} y1={y - 5} x2={X(x1)} y2={y + 5} />
      <line x1={X(x2)} y1={y - 5} x2={X(x2)} y2={y + 5} />
      <text x={(X(x1) + X(x2)) / 2} y={y - 5} textAnchor="middle">
        {label}
      </text>
    </g>
  )
  // 세로 치수선(세트 앞쪽에 놓는다)
  const dimV = (x: number, z1: number, z2: number, label: string, key: string, side: 'l' | 'r' = 'l') => (
    <g key={key} className="se-dim">
      <line x1={x} y1={Y(z1)} x2={x} y2={Y(z2)} />
      <line x1={x - 4} y1={Y(z1)} x2={x + 4} y2={Y(z1)} />
      <line x1={x - 4} y1={Y(z2)} x2={x + 4} y2={Y(z2)} />
      <text x={side === 'l' ? x - 6 : x + 6} y={(Y(z1) + Y(z2)) / 2 + 4} textAnchor={side === 'l' ? 'end' : 'start'}>
        {label}
      </text>
    </g>
  )

  const arcR = Math.min(46, g.depth * s * 0.45)
  const ax = X(0)
  const ay = Y(p.groundClearance)

  return (
    <svg className="side-elev" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="측면도">
      <text x={pad} y={20} className="se-title">
        측면도 (동쪽에서 본 단면, 왼쪽이 남)
      </text>
      {/* 지면 */}
      <line x1={0} y1={groundY} x2={W} y2={groundY} className="se-ground" />
      {Array.from({ length: Math.ceil(W / 12) }, (_, i) => (
        <line key={i} x1={i * 12} y1={groundY} x2={i * 12 - 7} y2={groundY + 7} className="se-hatch" />
      ))}

      {/* 동지 정오 햇빛과 그림자 */}
      {alt > 0 && (
        <g className="se-sun">
          <line x1={X(g.depth)} y1={Y(g.height)} x2={X(shadowTip)} y2={Y(p.groundClearance)} />
          <line x1={X(g.depth) - 40 / tanAlt} y1={Y(g.height) - 40} x2={X(g.depth)} y2={Y(g.height)} strokeDasharray="2 3" />
        </g>
      )}

      {set(0, 'front')}
      {set(backFront, 'back')}

      {/* 경사각 */}
      <path className="se-angle" d={`M ${ax + arcR} ${ay} A ${arcR} ${arcR} 0 0 0 ${ax + arcR * Math.cos(tilt)} ${ay - arcR * Math.sin(tilt)}`} />
      <line className="se-angle" x1={ax} y1={ay} x2={ax + arcR + 8} y2={ay} />
      <text className="se-label" x={ax + arcR + 4} y={ay - 6}>
        {p.tilt}°
      </text>

      {dimV(X(0) - 10, 0, p.groundClearance, `지상고 ${fmt(p.groundClearance)} m`, 'clr')}
      {dimV(X(g.depth) + 10, 0, g.height, `높이 ${fmt(g.height)} m`, 'h', 'r')}
      {dimH(0, g.depth, groundY + 26, `투영 ${fmt(g.depth)} m`, 'dep')}
      {dimH(g.depth, backFront, groundY + 26, `이격 ${fmt(p.rowSpacing)} m`, 'gap')}
      {dimH(0, backFront, groundY + 54, `열 피치 ${fmt(backFront)} m`, 'pitch')}
      <text className="se-label" x={X(g.depth / 2) - 8} y={Y(p.groundClearance + g.height / 2) - 14} textAnchor="end">
        경사면 {fmt(g.slope)} m
      </text>

      {/* 제목과 겹치지 않게 판정은 둘째 줄에 둔다 */}
      <text x={pad} y={38} className={margin >= 0 ? 'se-ok' : 'se-warn'}>
        {alt > 0
          ? `동지 정오 태양고도 ${fmt(alt, 1)}° · ${margin >= 0 ? `그림자 여유 ${fmt(margin)} m` : `뒷열에 ${fmt(-margin)} m 그늘`}`
          : '동지 정오에 해가 뜨지 않는 위도'}
      </text>
    </svg>
  )
}
