---
version: 1
slug: "src-components-landing-tsx"
primary_target: "src/components/Landing.tsx"
related_targets: ["src/landing.css"]
---

# Landing (첫 화면)

Scope: `src/components/Landing.tsx`, `src/landing.css`. Mode: Persuade.

Audience: 태양광 개발·시공사의 설계·영업 담당자. Job: 현장 전에 지번 하나로 용량·사업성 판단. Action: 지번을 넣고 설계 화면 열기. Proof: 실제 설계 화면 스크린샷(필지, AI 설계, 간격, 수동 편집, 음영, 도면). Constraints: 원래 남색 크롬 + 태양광 주황, Pretendard 유지. 고객·후기·통계 없음.

## Direction contract

THESIS: 설명 대신 실제 설계 화면 한 대가 화면에 고정되고, 스크롤이 그 화면을 지번부터 도면까지 단계별로 넘긴다. 아이콘 카드 그리드와 숫자 띠, 가짜 일러스트 히어로를 거부한다.

OWN-WORLD: 앱과 같은 남색 크롬(oklch 19% 0.03 258) 바탕, 주황(oklch 70% 0.18 48)은 행동 버튼과 단계 강조 테두리에만. 창틀처럼 둥근 모서리 하나의 앱 화면, 그 위를 움직이는 주황 강조 사각형. Pretendard 굵은 제목.

STORY: 지번만 넣으면 된다는 것을 이해하고, 실제 화면이 필지→AI 설계→간격→수동 편집→음영→도면까지 이어지는 걸 보고 믿고, 지번을 넣어 설계 화면을 연다.

FIRST VIEWPORT: 위쪽에 두 줄 제목과 한 문장, 바로 아래 지번 입력칸과 주황 '설계 시작' 버튼이 한 줄(실제로 동작). 그 아래 화면 폭 거의 전체의 앱 스크린샷 창이 첫 화면 하단에서 잘리며 시작한다.

FORM: 고정된 앱 화면 단계 투어(사용자 선택, 후보 목록 2번). seed:72f16169cb632f47. 시그니처 상호작용: 스크롤 단계마다 스크린샷이 바뀌고 주황 강조 사각형이 해당 패널로 미끄러져 이동.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance
