import { STRATEGIES, type Candidate } from '../lib/optimize'

interface Props {
  canRun: boolean
  running: boolean
  progress: { done: number; total: number; phase: string } | null
  results: Candidate[] | null
  error: string | null
  onRun: () => void
  onCancel: () => void
  onApply: (c: Candidate) => void
}

const fmt = (n: number, d = 0) => n.toLocaleString('ko-KR', { maximumFractionDigits: d, minimumFractionDigits: d })

export default function OptimizePanel(props: Props) {
  const { progress, results } = props
  return (
    <>
      <section className="card">
        <h2>AI 최적 배치</h2>
        <p className="hint" style={{ marginTop: 0 }}>
          모듈 규격, 세트 구성, 패널·세트 간격, 경계 이격은 배치 탭 설정을 그대로 두고 경사각, 방위각(정남 또는 필지 방향), 열
          이격거리, 첫 열 위치를 바꿔 가며 수십 가지 배치를 만들어 봅니다. 각 배치마다 세트 간 그림자와 장애물 음영을 반영한 연간
          발전량을 계산해 세 가지 기준의 최선안을 골라 드립니다.
        </p>
        {props.running ? (
          <>
            <div className="progress">
              <div style={{ width: `${progress ? (100 * progress.done) / Math.max(1, progress.total) : 0}%` }} />
            </div>
            <p className="hint">
              {progress?.phase ?? '준비 중'} {progress && progress.total > 1 && `(${progress.done + 1}/${progress.total})`}
            </p>
            <button type="button" className="secondary block" onClick={props.onCancel}>
              중단
            </button>
          </>
        ) : (
          <button type="button" className="block" disabled={!props.canRun} onClick={props.onRun}>
            최적 배치 찾기
          </button>
        )}
        {!props.canRun && <p className="hint">필지 탭에서 필지를 먼저 선택하세요.</p>}
        {props.error && <p className="error">{props.error}</p>}
      </section>

      {results?.map((c) => (
        <section className="card option" key={c.strategy}>
          <h2>{STRATEGIES[c.strategy].label}</h2>
          <p className="hint" style={{ marginTop: 0 }}>
            {STRATEGIES[c.strategy].detail}
          </p>
          <div className="hero">
            <strong>{fmt(c.annualKWh / 1000, 1)}</strong> MWh/년
          </div>
          <dl className="facts">
            <dt>설비용량</dt>
            <dd>
              {fmt(c.kWp, 1)} kWp ({fmt(c.sets.length)}세트)
            </dd>
            <dt>효율</dt>
            <dd>
              {fmt(c.specificYield)} kWh/kWp ({fmt(c.specificYield / 365, 2)} 시간/일)
            </dd>
            <dt>음영 손실</dt>
            <dd>{fmt(c.shadeLoss * 100, 1)} %</dd>
            <dt>경사·방위</dt>
            <dd>
              {fmt(c.params.tilt, 1)}° · {c.params.azimuth === 0 ? '정남' : `${c.params.azimuth > 0 ? '서' : '동'} ${Math.abs(c.params.azimuth)}°`}
            </dd>
            <dt>열 이격</dt>
            <dd>{fmt(c.params.rowSpacing, 1)} m</dd>
          </dl>
          <button type="button" className="block" onClick={() => props.onApply(c)}>
            이 배치 적용
          </button>
        </section>
      ))}
      {results && results.length === 0 && (
        <section className="card">
          <p className="hint">필지에 세트가 들어갈 자리가 없습니다. 경계 이격이나 세트 크기를 줄여 보세요.</p>
        </section>
      )}
    </>
  )
}
