import { useEffect, useRef, useState } from 'react'
import { LANDING_JIBUN_KEY } from '../lib/landing'
import '../landing.css'

interface Props {
  onStart: () => void
}

/** 투어 한 단계: 실제 설계 화면 스크린샷과 그 안에서 볼 곳(% 좌표) */
interface Step {
  id: string
  tab: string
  title: string
  body: string
  img: string
  alt: string
  focus: [left: number, top: number, width: number, height: number]
}

const STEPS: Step[] = [
  {
    id: 'parcel',
    tab: '필지',
    title: '지번을 넣으면 필지가 잡힙니다',
    body: 'VWorld 연속지적도로 경계와 지목·면적·용도지역·공시지가를 불러옵니다. 옆 지번을 더해 한 부지로 묶고, 키가 없으면 영역을 직접 그립니다.',
    img: 'tour-parcel.jpg',
    alt: '설계 화면 필지 단계. 지번 검색 칸과 지형 위에 그려진 필지',
    focus: [6, 37.2, 20.8, 10.6],
  },
  {
    id: 'ai',
    tab: 'AI 설계',
    title: 'AI가 수십 가지 배치를 돌립니다',
    body: '경사각·방위각·피치·첫 열 위치를 바꿔 가며 전기 설계, 음영·클리핑·케이블 손실, 토공량, 설치비까지 계산하고 LCOE와 IRR로 비교합니다.',
    img: 'tour-ai.jpg',
    alt: 'AI 가배치가 배치안을 분석하는 화면과 배치안 비교표',
    focus: [6, 56.7, 30, 10],
  },
  {
    id: 'spacing',
    tab: '간격',
    title: '간격과 이격은 직접 정합니다',
    body: '패널 간격과 세트 간격은 mm, 열 이격거리와 경계 이격은 m로 넣으면 바로 다시 배치합니다. 동지 9~15시에 그림자가 닿지 않는 이격도 추천합니다.',
    img: 'tour-spacing.jpg',
    alt: '배치 단계의 간격 입력칸. 패널 간격 20 mm, 세트 간격 500 mm, 열 이격거리 4 m',
    focus: [5.6, 50, 25, 34.6],
  },
  {
    id: 'edit',
    tab: '수동 편집',
    title: '마지막은 손으로 다듬습니다',
    body: '세트를 끌어 옮기고 회전·복제·영역 선택을 하고, 0.1 m 단위로 미세 이동합니다. 되돌리기와 타임라인으로 언제든 이전 안으로 돌아갑니다.',
    img: 'tour-edit.jpg',
    alt: '배치 편집 탭에서 세트 10개를 선택하고 미세 이동 버튼이 열린 화면',
    focus: [61.6, 32.8, 12.5, 19.4],
  },
  {
    id: 'shade',
    tab: '음영',
    title: '계절별 그림자와 산 그늘까지',
    body: '날짜와 시각마다 한국 위도의 태양 위치로 그림자를 그리고, 반경 5 km 지형의 지평선까지 넣어 하루 음영 손실을 발전량에 반영합니다.',
    img: 'tour-shade.jpg',
    alt: '음영 단계. 동지 08시 15분, 주변 산 지평선 그래프와 그늘진 세트',
    focus: [5.3, 10.5, 25.7, 50],
  },
  {
    id: 'drawings',
    tab: '도면',
    title: '도면과 보고서까지 한 번에',
    body: '표지부터 공사계획 평면도, 단선결선도, 절·성토 평면도까지 15종을 묶어 DXF·SVG·PDF로 받고, 입지검토 보고서로 인쇄합니다.',
    img: 'tour-drawings.jpg',
    alt: '도면 탭. 도면 목록 15종과 공사계획 평면도, 내보내기 버튼',
    focus: [22.4, 16, 30.8, 5.2],
  },
]

const IMG_BASE = `${import.meta.env.BASE_URL}landing/`

/** 지번 입력 + 시작 버튼. 넣은 지번은 설계 화면 검색 칸에 미리 채워진다. */
function JibunForm({ onStart, id }: { onStart: () => void; id: string }) {
  const [jibun, setJibun] = useState('')
  return (
    <form
      className="lp-jibun"
      onSubmit={(e) => {
        e.preventDefault()
        try {
          if (jibun.trim()) sessionStorage.setItem(LANDING_JIBUN_KEY, jibun.trim())
        } catch {
          // 저장소를 못 쓰면 빈 검색 칸으로 연다
        }
        onStart()
      }}
    >
      <label htmlFor={id} className="lp-sr">
        지번
      </label>
      <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
        <circle cx="10.5" cy="10.5" r="6" />
        <path d="M15 15l5 5" />
      </svg>
      <input id={id} value={jibun} onChange={(e) => setJibun(e.target.value)} placeholder="예: 전라남도 해남군 산이면 구성리 100" autoComplete="off" />
      <button type="submit">설계 시작</button>
    </form>
  )
}

/** 스크롤 위치로 지금 읽는 단계를 고른다: 화면 55% 줄을 지난 마지막 단계. */
function useActiveStep() {
  const refs = useRef<Array<HTMLElement | null>>([])
  const [active, setActive] = useState(0)
  useEffect(() => {
    let raf = 0
    const pick = () => {
      raf = 0
      const mid = window.innerHeight * 0.55
      let next = 0
      refs.current.forEach((el, i) => {
        if (el && el.getBoundingClientRect().top < mid) next = i
      })
      setActive(next)
    }
    const onScroll = () => {
      if (!raf) raf = requestAnimationFrame(pick)
    }
    pick()
    window.addEventListener('scroll', onScroll, { passive: true })
    window.addEventListener('resize', onScroll)
    return () => {
      window.removeEventListener('scroll', onScroll)
      window.removeEventListener('resize', onScroll)
      cancelAnimationFrame(raf)
    }
  }, [])
  return { refs, active }
}

/** 고정된 앱 창: 단계마다 스크린샷이 바뀌고 주황 사각형이 볼 곳으로 옮겨 간다. */
function AppWindow({ active }: { active: number }) {
  const [l, t, w, h] = STEPS[active].focus
  return (
    <figure className="lp-window">
      <div className="lp-window-bar" aria-hidden="true">
        <span className="lp-window-dots">
          <i />
          <i />
          <i />
        </span>
        <span className="lp-window-url">mooyooai.github.io/solar-layout</span>
      </div>
      <div className="lp-window-screen">
        {STEPS.map((s, i) => (
          <img
            key={s.id}
            src={IMG_BASE + s.img}
            width="1440"
            height="810"
            alt={i === active ? s.alt : ''}
            className={i === active ? 'is-on' : ''}
            loading={i < 2 ? 'eager' : 'lazy'}
            decoding="async"
          />
        ))}
        <span className="lp-focus" style={{ left: `${l}%`, top: `${t}%`, width: `${w}%`, height: `${h}%` }} aria-hidden="true" />
      </div>
    </figure>
  )
}

/** 처음 들어오면 보이는 소개 화면 */
export default function Landing({ onStart }: Props) {
  const { refs, active } = useActiveStep()
  return (
    <div className="lp">
      <header className="lp-nav">
        <a className="lp-brand" href="#top">
          <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
            <rect x="3" y="9" width="18" height="11" rx="1.5" transform="skewX(-12) translate(2 0)" />
            <path d="M8 9v11M13 9v11M3.5 14.5h17" />
            <circle cx="18.5" cy="4.5" r="2.2" />
          </svg>
          솔라 레이아웃
        </a>
        <nav aria-label="페이지">
          <a href="#tour">둘러보기</a>
          <a href="#start">시작하기</a>
        </nav>
        <button type="button" onClick={onStart}>
          설계 화면 열기
        </button>
      </header>

      <section className="lp-hero" id="top">
        <h1>
          지번만 넣으면
          <br />
          <span>AI가 가배치까지</span>
        </h1>
        <p className="lp-lead">지적도 확인부터 모듈 배치, 계절별 음영, 발전량과 경제성, 도면까지. 며칠 걸리던 부지 검토를 몇 분 안에 끝냅니다.</p>
        <JibunForm onStart={onStart} id="lp-jibun-top" />
        <p className="lp-note">회원가입 없이 바로 씁니다. 작업은 브라우저에 저장됩니다.</p>
      </section>

      <section className="lp-tour" id="tour" aria-label="설계 화면 둘러보기">
        <div className="lp-stage">
          <AppWindow active={active} />
          <ol className="lp-tabs" aria-hidden="true">
            {STEPS.map((s, i) => (
              <li key={s.id} className={i === active ? 'is-on' : i < active ? 'is-done' : ''}>
                {s.tab}
              </li>
            ))}
          </ol>
        </div>
        <ol className="lp-steps">
          {STEPS.map((s, i) => (
            <li
              key={s.id}
              ref={(el) => {
                refs.current[i] = el
              }}
              className={i === active ? 'is-on' : ''}
            >
              <h2>{s.title}</h2>
              <p>{s.body}</p>
              <img className="lp-step-shot" src={IMG_BASE + s.img} width="1440" height="810" alt={s.alt} loading="lazy" decoding="async" />
            </li>
          ))}
        </ol>
      </section>

      <section className="lp-close" id="start">
        <h2>첫 부지를 올려 보세요</h2>
        <p>지번을 넣으면 설계 화면이 그 지번을 검색 칸에 채운 채 열립니다.</p>
        <JibunForm onStart={onStart} id="lp-jibun-bottom" />
      </section>

      <footer className="lp-foot">
        <span>솔라 레이아웃 · 태양광 배치 설계 도구</span>
        <span>지도 데이터 VWorld · OpenStreetMap</span>
      </footer>
    </div>
  )
}
