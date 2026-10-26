import { MODULES, findModule, type ModuleSpec } from '../lib/catalog'
import type { LayoutParams } from '../lib/layout'

/** 모듈 목록을 제조사별로 묶는다. 일반 규격이 먼저 */
const GENERIC = '일반 규격'
/** 제조사 제품(목록 순서, 국산 먼저)을 위에, 일반 규격을 맨 아래에 */
const MODULE_GROUPS: Array<[string, ModuleSpec[]]> = [
  ...new Set([...MODULES.flatMap((m) => (m.maker ? [m.maker] : [])), GENERIC]),
].map((maker) => [maker, MODULES.filter((m) => (m.maker ?? GENERIC) === maker)])

/** 모듈 종류 고르기. 기본설계와 AI 설정 배치에서 같이 쓴다. */
export default function ModuleSelect({ params: p, onModule }: { params: LayoutParams; onModule: (m: ModuleSpec) => void }) {
  const preset = findModule(p.moduleLength, p.moduleWidth, p.moduleWatt)
  return (
    <>
      <label className="field" style={{ marginBottom: 8 }}>
        <span>모듈 종류</span>
        <select
          value={preset?.id ?? 'custom'}
          onChange={(e) => {
            const m = MODULES.find((x) => x.id === e.target.value)
            if (m) onModule(m)
          }}
        >
          {MODULE_GROUPS.map(([maker, list]) => (
            <optgroup key={maker} label={maker}>
              {list.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.maker ? `${m.model} · ${m.label}` : m.label}
                </option>
              ))}
            </optgroup>
          ))}
          <option value="custom" disabled>
            직접 입력
          </option>
        </select>
      </label>
      {preset?.maker && <p className="hint" style={{ marginTop: 0 }}>{`${preset.maker} ${preset.model}: 데이터시트 STC 값(Voc ${preset.voc} V, Isc ${preset.isc} A)으로 스트링을 짭니다.`}</p>}
    </>
  )
}
