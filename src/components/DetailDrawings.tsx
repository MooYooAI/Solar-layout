// 상세 도면: 측면도, 정면도, 간이 단면도, 모듈 외형도, 인버터 외형도, DC 결선도.
// 모두 배치·전기 설계 값으로 그리는 개략도다. 구조 부재와 외형 치수는 대표 참고값이라 시공 도면은 제품 데이터시트로 다시 그린다.

import { useState } from 'react'
import SideElevation from './SideElevation'
import ZoomFrame from './ZoomFrame'
import type { LayoutParams, SetGeometry } from '../lib/layout'
import type { ElecParams, ElecResult } from '../lib/electrical'
import { inverterSize, MODULE_THICKNESS, RACKING } from '../lib/catalog'
import { deg2rad } from '../lib/geo'

interface Props {
  params: LayoutParams
  geometry: SetGeometry
  lat: number
  elec: ElecResult | null
  elecParams: ElecParams
}

type Sheet = 'side' | 'front' | 'section' | 'module' | 'inverter' | 'dc'
const SHEETS: Array<[Sheet, string]> = [
  ['side', '측면도'],
  ['front', '정면도'],
  ['section', '간이 단면'],
  ['module', '모듈 외형'],
  ['inverter', '인버터 외형'],
  ['dc', 'DC 결선도'],
]

const W = 400
const fmt = (n: number, d = 2) => n.toLocaleString('ko-KR', { maximumFractionDigits: d })

/** 가로 치수선. x는 화면 좌표 */
function DimH({ x1, x2, y, label }: { x1: number; x2: number; y: number; label: string }) {
  return (
    <g className="se-dim">
      <line x1={x1} y1={y} x2={x2} y2={y} />
      <line x1={x1} y1={y - 4} x2={x1} y2={y + 4} />
      <line x1={x2} y1={y - 4} x2={x2} y2={y + 4} />
      <text x={(x1 + x2) / 2} y={y - 4} textAnchor="middle">
        {label}
      </text>
    </g>
  )
}

/** 세로 치수선. 글자는 side 쪽에 둔다 */
function DimV({ x, y1, y2, label, side = 'l' }: { x: number; y1: number; y2: number; label: string; side?: 'l' | 'r' }) {
  return (
    <g className="se-dim">
      <line x1={x} y1={y1} x2={x} y2={y2} />
      <line x1={x - 4} y1={y1} x2={x + 4} y2={y1} />
      <line x1={x - 4} y1={y2} x2={x + 4} y2={y2} />
      <text x={side === 'l' ? x - 5 : x + 5} y={(y1 + y2) / 2 + 4} textAnchor={side === 'l' ? 'end' : 'start'}>
        {label}
      </text>
    </g>
  )
}

/** 지시선 붙은 부재 이름 */
function Callout({ x, y, tx, ty, label }: { x: number; y: number; tx: number; ty: number; label: string }) {
  return (
    <g className="dd-callout">
      <circle cx={x} cy={y} r={2} />
      <polyline points={`${x},${y} ${tx},${ty} ${tx + (tx > x ? 1 : -1) * 6},${ty}`} />
      <text x={tx + (tx > x ? 9 : -9)} y={ty + 4} textAnchor={tx > x ? 'start' : 'end'}>
        {label}
      </text>
    </g>
  )
}

function Ground({ y }: { y: number }) {
  return (
    <>
      <line x1={0} y1={y} x2={W} y2={y} className="se-ground" />
      {Array.from({ length: Math.ceil(W / 12) }, (_, i) => (
        <line key={i} x1={i * 12} y1={y} x2={i * 12 - 7} y2={y + 7} className="se-hatch" />
      ))}
    </>
  )
}

const dims = (p: LayoutParams) => ({
  along: (p.portrait ? p.moduleWidth : p.moduleLength) / 1000,
  across: (p.portrait ? p.moduleLength : p.moduleWidth) / 1000,
  gap: p.moduleGap / 1000,
})

/** 정면도: 남쪽에서 본 세트. 한 세트 전체와 옆 세트 일부, 세트 사이 간격. */
export function FrontElevation({ params: p, geometry: g }: Props) {
  const pad = 46
  const { along, across, gap } = dims(p)
  const setGap = p.setGap / 1000
  const span = g.width + setGap + Math.min(g.width * 0.3, 3)
  const s = (W - pad * 2) / span
  const H = Math.max(g.height * s, 50) + 120
  const gy = H - 60
  const X = (m: number) => pad + m * s
  const Y = (m: number) => gy - m * s
  const t = deg2rad(p.tilt)
  const n = Math.max(2, Math.ceil(g.width / 3) + 1)
  const inset = Math.min(0.3, g.width / 4)
  const posts = Array.from({ length: n }, (_, i) => -g.width / 2 + inset + ((g.width - 2 * inset) * i) / (n - 1))
  const setAt = (x0: number, clipTo: number, key: string) => {
    const mods = []
    for (let r = 0; r < p.setRows; r++)
      for (let c = 0; c < p.setCols; c++) {
        const mx = x0 + c * (along + gap)
        if (mx >= clipTo) continue
        const z0 = p.groundClearance + r * (across + gap) * Math.sin(t)
        const z1 = z0 + across * Math.sin(t)
        mods.push(<rect key={`${r}-${c}`} x={X(mx)} y={Y(z1)} width={Math.min(along, clipTo - mx) * s} height={(z1 - z0) * s} className="dd-module" />)
      }
    const back = p.groundClearance + g.depth * Math.tan(t)
    return (
      <g key={key}>
        {posts.map((px, i) => {
          const x = x0 + g.width / 2 + px
          return x < clipTo ? (
            <g key={i}>
              <line x1={X(x)} y1={Y(0)} x2={X(x)} y2={Y(back)} className="dd-post-back" />
              <line x1={X(x)} y1={Y(0)} x2={X(x)} y2={Y(p.groundClearance)} className="se-post" />
            </g>
          ) : null
        })}
        {mods}
      </g>
    )
  }
  return (
    <svg className="side-elev" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="정면도">
      <text x={pad} y={18} className="se-title">
        정면도 (남쪽에서 본 모습)
      </text>
      <text x={W - pad} y={18} textAnchor="end" className="se-label">
        {p.setCols}열 × {p.setRows}단 · {p.portrait ? '세로' : '가로'} 배치
      </text>
      <Ground y={gy} />
      {setAt(0, g.width, 'a')}
      {setAt(g.width + setGap, span, 'b')}
      <DimH x1={X(0)} x2={X(g.width)} y={gy + 22} label={`세트 폭 ${fmt(g.width)} m`} />
      <DimH x1={X(g.width)} x2={X(g.width + setGap)} y={gy + 44} label={`세트 간격 ${fmt(setGap)} m`} />
      <DimH x1={X(0)} x2={X(along)} y={Y(g.height) - 10} label={`${fmt(along * 1000, 0)}`} />
      <DimV x={X(0) - 8} y1={Y(0)} y2={Y(g.height)} label={`${fmt(g.height)} m`} />
      <text x={X(along + gap / 2)} y={Y(g.height) - 26} textAnchor="middle" className="se-label">
        모듈 간격 {p.moduleGap} mm
      </text>
    </svg>
  )
}

/** 간이 단면도: 세트 하나의 구조 부재. 기초 형식은 구조물 방식을 따른다. */
export function SimpleSection({ params: p, geometry: g }: Props) {
  const pad = 46
  const { across, gap } = dims(p)
  const t = deg2rad(p.tilt)
  const spec = RACKING[p.racking]
  const embed = p.racking === 'concrete' ? 0.8 : 1.5
  const s = Math.min((W - pad * 2 - 90) / g.depth, 150 / Math.max(g.height + embed, 1))
  const gy = 40 + g.height * s
  const H = gy + embed * s + 40
  const x0 = pad + 70
  const X = (m: number) => x0 + m * s
  const Y = (m: number) => gy - m * s
  const legIn = Math.min(0.2, g.depth / 4)
  const zTop = (x: number) => p.groundClearance + x * Math.tan(t)
  // 모듈 아래 경사보(레일 아래 0.12m), 그 위 퍼린
  const off = 0.12
  const rafter = (x: number) => zTop(x) - off / Math.cos(t)
  const fx = legIn
  const bx = g.depth - legIn
  const purlins: number[] = []
  for (let r = 0; r < p.setRows; r++) {
    const a = r * (across + gap)
    purlins.push(a + across * 0.2, a + across * 0.8)
  }
  const ps = (along: number) => [along * Math.cos(t), p.groundClearance + along * Math.sin(t)] as const
  const footing = (x: number) =>
    p.racking === 'concrete' ? (
      <rect x={X(x) - 0.3 * s} y={Y(0)} width={0.6 * s} height={embed * s} className="dd-footing" />
    ) : (
      <line x1={X(x)} y1={Y(0)} x2={X(x)} y2={Y(-embed)} className="dd-pile" />
    )
  const [mx, mz] = ps(across * 0.5)
  return (
    <svg className="side-elev" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="간이 단면도">
      <text x={16} y={18} className="se-title">
        간이 단면도
      </text>
      <text x={W - 16} y={18} textAnchor="end" className="se-label">
        {spec.label}
      </text>
      <Ground y={gy} />
      {footing(fx)}
      {footing(bx)}
      <line x1={X(fx)} y1={Y(0)} x2={X(fx)} y2={Y(rafter(fx))} className="dd-member" />
      <line x1={X(bx)} y1={Y(0)} x2={X(bx)} y2={Y(rafter(bx))} className="dd-member" />
      <line x1={X(fx)} y1={Y(0.15)} x2={X(bx)} y2={Y(rafter(bx) * 0.55)} className="dd-brace" />
      <line x1={X(0)} y1={Y(rafter(0))} x2={X(g.depth)} y2={Y(rafter(g.depth))} className="dd-member" />
      {purlins.map((a, i) => {
        const [px, pz] = ps(a)
        const cx = X(px + Math.sin(t) * off * 0.5)
        const cy = Y(pz - Math.cos(t) * off * 0.5)
        return <rect key={i} x={cx - 4} y={cy - 4} width={8} height={8} className="dd-purlin" transform={`rotate(${-p.tilt} ${cx} ${cy})`} />
      })}
      {Array.from({ length: p.setRows }, (_, r) => {
        const [ax, az] = ps(r * (across + gap))
        const [bx2, bz] = ps(r * (across + gap) + across)
        return <line key={r} x1={X(ax)} y1={Y(az)} x2={X(bx2)} y2={Y(bz)} className="se-module" />
      })}
      <Callout x={X(mx)} y={Y(mz)} tx={X(mx) - 40} ty={Y(mz) - 34} label="모듈" />
      {purlins.length > 1 && (() => {
        const [px, pz] = ps(purlins[purlins.length - 1])
        return <Callout x={X(px)} y={Y(pz) + 6} tx={X(g.depth) + 30} ty={Y(pz) - 4} label="퍼린 (C형강)" />
      })()}
      <Callout x={X(g.depth * 0.75)} y={Y(rafter(g.depth * 0.75))} tx={X(g.depth) + 30} ty={Y(rafter(g.depth * 0.75)) + 22} label="경사보" />
      <Callout x={X(bx)} y={Y(rafter(bx) * 0.3)} tx={X(g.depth) + 30} ty={Y(rafter(bx) * 0.3)} label="후주" />
      <Callout x={X(fx)} y={Y(p.groundClearance * 0.4)} tx={X(0) - 36} ty={Y(p.groundClearance * 0.4) - 6} label="전주" />
      <Callout x={(X(fx) + X(bx)) / 2} y={(Y(0.15) + Y(rafter(bx) * 0.55)) / 2} tx={(X(fx) + X(bx)) / 2 - 10} ty={Y(-0.25) + 10} label="가새" />
      <Callout x={X(bx)} y={Y(-embed * 0.6)} tx={X(g.depth) + 30} ty={Y(-embed * 0.6)} label={p.racking === 'concrete' ? '독립기초' : '파일 기초'} />
      <DimV x={X(0) - 14} y1={Y(0)} y2={Y(-embed)} label={`근입 ${fmt(embed, 1)} m`} />
      <text x={16} y={H - 10} className="se-label">
        부재·근입 깊이는 참고값입니다. 구조 계산으로 정합니다.
      </text>
    </svg>
  )
}

/** 모듈 외형도: 앞면(셀 배열), 옆면(두께), 뒷면(정션박스) */
export function ModuleOutline({ params: p, elecParams: e }: Props) {
  const L = p.moduleLength
  const Wd = p.moduleWidth
  const T = MODULE_THICKNESS
  const s = Math.min(150 / Wd, 230 / L)
  const fw = Wd * s
  const fh = L * s
  const top = 34
  const left = 50
  const colsCell = 6
  const cell = Wd / colsCell
  const rowsCell = Math.max(2, Math.round(L / cell / 2) * 2)
  const frame = 30 * s
  const cells = []
  for (let r = 0; r < rowsCell; r++)
    for (let c = 0; c < colsCell; c++)
      cells.push(
        <rect
          key={`${r}-${c}`}
          x={left + frame + (c * (fw - 2 * frame)) / colsCell + 0.5}
          y={top + frame + (r * (fh - 2 * frame)) / rowsCell + 0.5}
          width={(fw - 2 * frame) / colsCell - 1}
          height={(fh - 2 * frame) / rowsCell - 1}
          className="dd-cell"
        />,
      )
  const sideX = left + fw + 46
  const backX = sideX + T * s * 2.5 + 46
  const H = top + fh + 120
  return (
    <svg className="side-elev" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="모듈 외형도">
      <text x={16} y={18} className="se-title">
        모듈 외형도
      </text>
      <text x={W - 16} y={18} textAnchor="end" className="se-label">
        {p.moduleWatt} W · {L}×{Wd}×{T} mm
      </text>
      <rect x={left} y={top} width={fw} height={fh} className="dd-frame" />
      {cells}
      <line x1={left + frame} y1={top + fh / 2} x2={left + fw - frame} y2={top + fh / 2} className="dd-split" />
      <DimH x1={left} x2={left + fw} y={top + fh + 18} label={`${Wd}`} />
      <DimV x={left - 10} y1={top} y2={top + fh} label={`${L}`} />
      <text x={left + fw / 2} y={top + fh + 40} textAnchor="middle" className="se-label">
        앞면
      </text>

      <rect x={sideX} y={top} width={T * s * 2.5} height={fh} className="dd-frame" />
      <DimH x1={sideX} x2={sideX + T * s * 2.5} y={top + fh + 18} label={`${T}`} />
      <text x={sideX + T * s * 1.25} y={top + fh + 40} textAnchor="middle" className="se-label">
        옆면
      </text>

      <rect x={backX} y={top} width={fw * 0.6} height={fh} className="dd-back" />
      <rect x={backX + fw * 0.3 - 10} y={top + 10} width={20} height={14} className="dd-jbox" />
      <line x1={backX + fw * 0.3 - 6} y1={top + 24} x2={backX + 6} y2={top + 70} className="dd-cable" />
      <line x1={backX + fw * 0.3 + 6} y1={top + 24} x2={backX + fw * 0.6 - 6} y2={top + 70} className="dd-cable" />
      <text x={backX + fw * 0.3} y={top + fh + 40} textAnchor="middle" className="se-label">
        뒷면 (정션박스)
      </text>

      <g className="dd-spec">
        {[
          `Pmax ${p.moduleWatt} W`,
          `Voc ${fmt(e.voc, 1)} V · Vmp ${fmt(e.vmp, 1)} V`,
          `Isc ${fmt(e.isc, 2)} A · Imp ${fmt(e.imp, 2)} A`,
          `셀 ${colsCell}×${rowsCell} (하프컷) · 두께는 참고값`,
        ].map((t, i) => (
          <text key={i} x={16} y={H - 62 + i * 15}>
            {t}
          </text>
        ))}
      </g>
    </svg>
  )
}

/** 인버터 외형도: 앞면, 옆면(방열핀), 아래면 입출력 */
export function InverterOutline({ elecParams: e, elec }: Props) {
  const sz = inverterSize(e.inverterKW)
  const s = Math.min(170 / sz.w, 150 / sz.h)
  const fw = sz.w * s
  const fh = sz.h * s
  const top = 40
  const left = 50
  const sideX = left + fw + 50
  const sd = sz.d * s
  const nIn = Math.min(12, Math.max(4, Math.ceil(((elec?.inverters[0]?.strings ?? 8) + 1) / 2) * 2))
  const H = top + fh + 130
  return (
    <svg className="side-elev" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="인버터 외형도">
      <text x={16} y={18} className="se-title">
        인버터 외형도
      </text>
      <text x={W - 16} y={18} textAnchor="end" className="se-label">
        {e.inverterKW} kW 스트링{elec ? ` · ${elec.inverters.length}대` : ''}
      </text>
      <rect x={left} y={top} width={fw} height={fh} rx={4} className="dd-frame" />
      <rect x={left + fw * 0.12} y={top + fh * 0.12} width={fw * 0.22} height={fh * 0.14} className="dd-back" />
      <circle cx={left + fw * 0.82} cy={top + fh * 0.18} r={5} className="dd-led" />
      {Array.from({ length: nIn }, (_, i) => (
        <rect key={i} x={left + 8 + (i * (fw * 0.6)) / nIn} y={top + fh - 2} width={6} height={9} className={i % 2 ? 'dd-pin-neg' : 'dd-pin-pos'} />
      ))}
      <rect x={left + fw - 34} y={top + fh - 2} width={22} height={11} className="dd-jbox" />
      <DimH x1={left} x2={left + fw} y={top + fh + 30} label={`${sz.w}`} />
      <DimV x={left - 10} y1={top} y2={top + fh} label={`${sz.h}`} />
      <text x={left + fw / 2} y={top + fh + 50} textAnchor="middle" className="se-label">
        앞면 · 아래 DC 입력(+/−)·AC 출력
      </text>
      <rect x={sideX} y={top} width={sd} height={fh} className="dd-frame" />
      {Array.from({ length: 9 }, (_, i) => (
        <line key={i} x1={sideX + sd * 0.55} y1={top + 8 + (i * (fh - 16)) / 8} x2={sideX + sd} y2={top + 8 + (i * (fh - 16)) / 8} className="dd-fin" />
      ))}
      <DimH x1={sideX} x2={sideX + sd} y={top + fh + 30} label={`${sz.d}`} />
      <text x={sideX + sd / 2} y={top + fh + 50} textAnchor="middle" className="se-label">
        옆면 (방열핀)
      </text>
      <g className="dd-spec">
        {[
          `정격 출력 ${e.inverterKW} kW · AC ${e.acV} V 3상`,
          `최대 DC ${e.maxDcV} V · MPPT ${e.mpptMinV}~${e.mpptMaxV} V`,
          `외형 ${sz.w}×${sz.h}×${sz.d} mm · 약 ${sz.kg} kg (같은 용량대 참고값)`,
        ].map((t, i) => (
          <text key={i} x={16} y={H - 48 + i * 15}>
            {t}
          </text>
        ))}
      </g>
    </svg>
  )
}

/** DC 결선도: 인버터 한 대에 물리는 스트링. 모듈 직렬 → +/− 케이블 → MPPT 입력(2스트링씩) → DC 차단 → 인버터 */
function DcWiring(props: Props) {
  const { elec } = props
  const [inv, setInv] = useState(0)
  if (!elec || !elec.inverters.length) return <p className="empty">세트를 배치하면 스트링 구성으로 DC 결선도를 그립니다.</p>
  const k = Math.min(inv, elec.inverters.length - 1)
  return (
    <>
      {elec.inverters.length > 1 && (
        <label className="dd-pick">
          인버터
          <select value={k} onChange={(ev) => setInv(Number(ev.target.value))}>
            {elec.inverters.map((v, i) => (
              <option key={v.id} value={i}>
                INV-{v.id} ({v.strings}스트링)
              </option>
            ))}
          </select>
        </label>
      )}
      <ZoomFrame title={`DC 결선도 · INV-${elec.inverters[k].id}`}>
        <DcWiringSheet {...props} elec={elec} inverter={k} />
      </ZoomFrame>
    </>
  )
}

/** 인버터 한 대의 DC 결선도 */
export function DcWiringSheet({ elec, elecParams: e, params: p, inverter: k }: Props & { elec: ElecResult; inverter: number }) {
  const strings = elec.strings.filter((s) => s.inverter === k)
  const shown = strings.slice(0, 16)
  const rowH = 22
  const top = 52
  const H = top + Math.max(shown.length, 2) * rowH + 110
  const invX = 262
  const invTop = top - 10
  const invH = Math.max(shown.length, 2) * rowH + 4
  const mppt = Math.ceil(strings.length / 2)
  const modW = 16
  const pMax = elec.inverters[k].kWdc
  return (
      <svg className="side-elev" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="DC 결선도">
        <text x={16} y={18} className="se-title">
          DC 결선도 · INV-{elec.inverters[k].id}
        </text>
        <text x={W - 16} y={18} textAnchor="end" className="se-label">
          {strings.length}스트링 × {elec.stringLen}직렬 · {fmt(pMax, 1)} kWdc
        </text>
        <text x={16} y={36} className="se-label">
          {p.moduleWatt} W 모듈 · 저온 Voc {fmt(elec.vocCold, 0)} V / 고온 Vmp {fmt(elec.vmpHot, 0)} V · DC {e.dcCableMm2} ㎟
        </text>
        <rect x={invX} y={invTop} width={90} height={invH} className="dd-frame" />
        {shown.map((st, i) => {
          const y = top + i * rowH + rowH / 2
          const m = mppt > 0 ? Math.floor(i / 2) : 0
          return (
            <g key={st.id}>
              <text x={16} y={y + 4} className="dd-small">
                S{i + 1}
              </text>
              {[0, 1].map((j) => (
                <rect key={j} x={44 + j * (modW + 4)} y={y - 7} width={modW} height={14} className="dd-pv" />
              ))}
              <line x1={44 + 2 * (modW + 4) - 4} y1={y} x2={110} y2={y} className="dd-wire" strokeDasharray="2 2" />
              <rect x={110} y={y - 7} width={modW} height={14} className="dd-pv" />
              <text x={140} y={y + 4} className="dd-small">
                ×{st.modules}
              </text>
              <line x1={160} y1={y - 3} x2={invX - 46} y2={y - 3} className="dd-pos" />
              <line x1={160} y1={y + 3} x2={invX - 46} y2={y + 3} className="dd-neg" />
              <text x={176} y={y - 6} className="dd-tiny">
                {fmt(st.dcCableM, 0)} m
              </text>
              {/* 퓨즈·커넥터 */}
              <rect x={invX - 46} y={y - 6} width={10} height={12} className="dd-fuse" />
              <line x1={invX - 36} y1={y} x2={invX} y2={y} className="dd-wire" />
              {i % 2 === 0 && (
                <text x={invX + 4} y={y + 12} className="dd-tiny">
                  MPPT{m + 1}
                </text>
              )}
            </g>
          )
        })}
        {strings.length > shown.length && (
          <text x={44} y={top + shown.length * rowH + 12} className="dd-small">
            … 외 {strings.length - shown.length}스트링 같은 구성
          </text>
        )}
        <text x={invX + 64} y={invTop + invH / 2 - 4} textAnchor="middle" className="se-title">
          INV
        </text>
        <text x={invX + 64} y={invTop + invH / 2 + 12} textAnchor="middle" className="dd-small">
          {e.inverterKW} kW
        </text>
        <line x1={invX + 90} y1={invTop + invH / 2} x2={W - 16} y2={invTop + invH / 2} className="dd-wire" />
        <text x={W - 4} y={invTop + invH / 2 - 6} textAnchor="end" className="dd-small">
          AC {e.acV} V
        </text>
        <g className="dd-legend" transform={`translate(16 ${H - 52})`}>
          <line x1={0} y1={0} x2={18} y2={0} className="dd-pos" />
          <text x={24} y={4}>
            (+) 케이블
          </text>
          <line x1={100} y1={0} x2={118} y2={0} className="dd-neg" />
          <text x={124} y={4}>
            (−) 케이블
          </text>
          <rect x={196} y={-6} width={10} height={12} className="dd-fuse" />
          <text x={212} y={4}>
            스트링 퓨즈·DC 차단
          </text>
          <text x={0} y={22}>
            MPPT 입력은 2스트링씩 묶어 그렸습니다(데이터시트 확인).
          </text>
        </g>
      </svg>
  )
}

export default function DetailDrawings(props: Props) {
  const [sheet, setSheet] = useState<Sheet>('side')
  return (
    <div className="drawing details">
      <div className="dd-tabs" role="tablist" aria-label="상세 도면">
        {SHEETS.map(([k, label]) => (
          <button key={k} type="button" role="tab" aria-selected={sheet === k} onClick={() => setSheet(k)}>
            {label}
          </button>
        ))}
      </div>
      {sheet === 'dc' ? (
        <DcWiring {...props} />
      ) : (
        <ZoomFrame title={SHEETS.find(([k]) => k === sheet)![1]}>
          {sheet === 'side' && <SideElevation params={props.params} geometry={props.geometry} lat={props.lat} />}
          {sheet === 'front' && <FrontElevation {...props} />}
          {sheet === 'section' && <SimpleSection {...props} />}
          {sheet === 'module' && <ModuleOutline {...props} />}
          {sheet === 'inverter' && <InverterOutline {...props} />}
        </ZoomFrame>
      )}
      <p className="hint">
        {sheet === 'side'
          ? '그림자 여유는 동지 정오에 앞열 상단 그림자가 뒷열 앞단에 닿는지로 봅니다.'
          : '배치·전기 설계 값을 바꾸면 바로 다시 그립니다. 개략도라 시공 도면은 제품 데이터시트로 확정합니다.'}
      </p>
    </div>
  )
}
