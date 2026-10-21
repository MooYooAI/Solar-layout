---
version: 1
slug: "src-components-landing-tsx"
primary_target: "src/components/Landing.tsx"
related_targets: ["src/landing.css"]
---

# Landing (첫 화면)

Scope: `src/components/Landing.tsx`, `src/landing.css`. Mode: Persuade.

Audience: 태양광 개발·시공사의 설계·영업 담당자. Job: 현장 전에 지번 하나로 용량·사업성 판단. Action: 지번을 넣고 설계 화면 열기. Proof: 앱과 같은 태양 위치 식(src/lib/sun.ts)으로 실제 계산한 그림자와 무음영 이격, 실제 설계 화면 스크린샷 한 장. Constraints: 원래 남색 크롬 + 태양광 주황, Pretendard 유지. 고객·후기·통계 없음. 예시 부지는 예시라고 밝힌다.

## Direction contract

THESIS: 페이지 한 장이 동지 하루다. 스크롤이 해를 아침에서 저녁으로 옮기고, 예시 배치도 위 그림자가 실제 계산대로 늘고 줄며, 그 시각에 맞는 기능이 차례로 나온다. 아이콘 카드 그리드, 숫자 띠, 지어낸 성과 수치를 거부한다.

OWN-WORLD: 앱과 같은 남색 크롬(oklch 19% 0.03 258) 바탕. 주황(oklch 70% 0.18 48)은 해와 행동 버튼에만. 위에서 내려다본 배치도(필지 경계, 남향 세트, 그림자 평행사변형)와 남쪽을 바라본 하늘 띠(해의 궤적, 서쪽 능선). 시각 표시는 고정폭 숫자. Pretendard 굵은 제목.

STORY: 지번만 넣으면 된다는 것을 이해하고, 동지 하루 동안 그림자가 어떻게 움직이고 도구가 그걸 어떻게 계산하는지 보며 믿고, 지번을 넣어 설계 화면을 연다.

FIRST VIEWPORT: 위쪽에 두 줄 제목, 한 문장, 바로 아래 실제로 동작하는 지번 입력칸과 주황 '설계 시작' 버튼. 그 아래 해 뜨기 직전 하늘 띠와 배치도가 첫 화면 하단에서 잘리며 시작한다.

FORM: 동지 하루가 흐르는 페이지(사용자 선택, 후보 목록 1번). seed:72f16169cb632f47. 시그니처 상호작용: 스크롤 위치가 태양시를 정하고, 해가 하늘 띠의 궤적을 따라 움직이며 배치도 그림자 방향·길이와 가려진 면적 비율이 매 프레임 다시 계산된다. 오후 늦게 해가 서쪽 능선 뒤로 넘어가면 부지 전체가 그늘에 든다.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance
