import { INVERTERS } from '../lib/catalog'
import { stringRange, type ElecParams, type ElecResult } from '../lib/electrical'
import type { DesignMetrics } from '../lib/design'
import NumberInput from './NumberInput'

interface Props {
  elec: ElecParams
  onElec: (e: ElecParams) => void
  result: ElecResult | null
  metrics: DesignMetrics | null
  busy: boolean
  hasSets: boolean
}

const fmt = (n: number, d = 0) => n.toLocaleString('ko-KR', { maximumFractionDigits: d, minimumFractionDigits: d })

export default function ElectricalPanel(props: Props) {
  const { elec: e, onElec, result: r, metrics: m } = props
  const set = <K extends keyof ElecParams>(k: K, v: ElecParams[K]) => onElec({ ...e, [k]: v })
  const num = (k: keyof ElecParams, label: string, unit: string, step = 1, min: number | undefined = 0) => (
    <label className="field">
      <span>{label}</span>
      <NumberInput
        step={step}
        min={min}
        value={e[k] as number}
        onValue={(v) => set(k, v as never)}
      />
      <em>{unit}</em>
    </label>
  )
  const range = stringRange(e)

  return (
    <>
      <section className="card">
        <h2>인버터와 DC/AC 비율</h2>
        <label className="field" style={{ marginBottom: 8 }}>
          <span>인버터 종류</span>
          <select
            value={e.inverterId}
            onChange={(ev) => {
              const inv = INVERTERS.find((i) => i.id === ev.target.value)
              if (inv)
                onElec({ ...e, inverterId: inv.id, inverterKW: inv.kw, maxDcV: inv.maxDcV, mpptMinV: inv.mpptMinV, mpptMaxV: inv.mpptMaxV, acV: inv.acV })
              else set('inverterId', 'custom')
            }}
          >
            {INVERTERS.map((i) => (
              <option key={i.id} value={i.id}>
                {i.label}
              </option>
            ))}
            <option value="custom">직접 입력</option>
          </select>
        </label>
        <div className="grid2">
          {num('dcAcRatio', '목표 DC/AC', '', 0.05, 0.5)}
          {num('inverterKW', '정격 출력', 'kW', 5, 1)}
          {num('maxDcV', '최대 DC 전압', 'V', 50, 1)}
          {num('acV', 'AC 전압', 'V', 10, 1)}
          {num('mpptMinV', 'MPPT 최소', 'V', 10)}
          {num('mpptMaxV', 'MPPT 최대', 'V', 10)}
        </div>
        <p className="hint">DC/AC 비율을 높이면 인버터가 줄어 설치비가 내려가지만, 맑은 날 한낮에 출력이 잘리는 클리핑 손실이 늘어납니다.</p>
      </section>

      <section className="card">
        <h2>모듈 전기 사양</h2>
        <div className="grid2">
          {num('voc', '개방전압 Voc', 'V', 0.1)}
          {num('vmp', '최대출력전압 Vmp', 'V', 0.1)}
          {num('isc', '단락전류 Isc', 'A', 0.01)}
          {num('imp', '최대출력전류 Imp', 'A', 0.01)}
          {num('betaVoc', 'Voc 온도계수', '%/°C', 0.01, undefined)}
          {num('gammaPmax', 'Pmax 온도계수', '%/°C', 0.01, undefined)}
          {num('minTemp', '설계 최저 기온', '°C', 1, undefined)}
          {num('dcCableMm2', 'DC 케이블', '㎟', 1, 1)}
        </div>
        <p className="hint">
          최저 기온에서 개방전압 {fmt(range.vocCold, 1)} V, 셀 {e.maxCellTemp}°C에서 동작전압 {fmt(range.vmpHot, 1)} V라서 직렬은{' '}
          {range.minLen}~{range.maxLen}장이 가능합니다. 직접 설정에서 모듈 종류를 고르면 이 값도 바뀝니다.
        </p>
      </section>

      {!props.hasSets ? (
        <p className="hint">AI 설계 단계에서 모듈을 먼저 배치하세요.</p>
      ) : !r ? (
        <p className="hint">{props.busy ? '계산 중…' : '전기 설계를 할 수 없습니다.'}</p>
      ) : (
        <>
          <section className="card">
            <h2>전기 설계 결과 {props.busy && <span className="hint">(다시 계산 중)</span>}</h2>
            <dl className="facts wide">
              <dt>스트링</dt>
              <dd>
                {fmt(r.strings.length)}회로 × {r.stringLen}장 ({fmt(r.stringLen * e.vmp)} V)
              </dd>
              <dt>인버터</dt>
              <dd>
                {fmt(e.inverterKW)} kW × {r.inverters.length}대 (대당 {Math.min(...r.inverters.map((v) => v.strings))}
                {Math.min(...r.inverters.map((v) => v.strings)) !== Math.max(...r.inverters.map((v) => v.strings)) &&
                  `~${Math.max(...r.inverters.map((v) => v.strings))}`}
                회로)
              </dd>
              <dt>용량</dt>
              <dd>
                DC {fmt(r.kWdc, 1)} kWp · AC {fmt(r.kWac)} kW
              </dd>
              <dt>DC/AC</dt>
              <dd>
                <strong>{r.dcAc.toFixed(2)}</strong>
                {m && ` (클리핑 손실 ${fmt(m.clipLoss * 100, 2)}%)`}
              </dd>
              <dt>DC 케이블</dt>
              <dd>
                {fmt(r.dcCableM)} m, {e.dcCableMm2}㎟, 정격 손실 {fmt(r.dcLossPct, 2)}%
              </dd>
              <dt>AC 케이블</dt>
              <dd>
                {fmt(r.acCableM)} m ({[...new Set(r.inverters.map((v) => v.acCableMm2))].sort((a, b) => a - b).join('·')}㎟), 정격 손실{' '}
                {fmt(r.acLossPct, 2)}%
              </dd>
              <dt>계통연계</dt>
              <dd>
                {r.connection === 'MV'
                  ? `특고압 22.9kV, 변압기 ${fmt(r.transformerKVA ?? 0)} kVA`
                  : `저압 ${e.acV}V (100kW 미만)`}
              </dd>
              {r.unusedModules > 0 && (
                <>
                  <dt>미연결 모듈</dt>
                  <dd>{fmt(r.unusedModules)} 장</dd>
                </>
              )}
            </dl>
            {r.warnings.map((w) => (
              <p key={w} className="error">
                {w}
              </p>
            ))}
            <p className="hint">
              세트를 열마다 지그재그로 이어 스트링을 만들고, 이웃한 스트링을 인버터에 고르게 묶었습니다. 지도에서 세트 색이 인버터 묶음이고,
              점선은 인버터에서 수배전반(부지 경계 가장 가까운 곳)까지 AC 케이블 경로입니다. 단선결선도는 오른쪽 작업면에서 볼 수 있습니다.
            </p>
          </section>

        </>
      )}
    </>
  )
}
