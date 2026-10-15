# 태양광 배치 설계

지번으로 필지를 찾고, 지적도 위에 태양광 모듈을 가배치하고, 계절별 음영과 발전량을 확인하는 웹 도구입니다.

## 진행 단계

1. **지번 검색과 지적도** (완료): VWorld 주소 검색, 연속지적도 표시, 필지 경계·면적·공시지가·용도지역 표시, 영역 직접 그리기, 사각형 수치 입력(가로·세로·회전), 옆 지번을 더해 여러 필지를 한 부지로 합치기, 용도지역 지도 레이어, 거리·면적 재기
2. **모듈 가배치와 수동 편집** (완료): 모듈 규격·세트 구성·경사각·방위각, 패널 간격·세트 간격·열 이격거리·경계 이격 설정, 동지 기준 열 이격거리 추천, 자동 배치, 선택·이동·회전·추가·삭제, 되돌리기·다시실행(Ctrl+Z / Ctrl+Shift+Z)
3. **음영 분석과 발전량** (완료): 날짜·시각별 태양 위치와 그림자(세트 간, 건물·나무 장애물), 그늘진 모듈 비율, 월별·연간 발전량과 음영 손실
4. **AI 최적 배치** (완료): 경사각·방위각·열 이격거리·첫 열 위치를 바꿔 수십 가지 배치를 만들고, 음영을 반영한 연간 발전량으로 "발전량 최대", "균형", "효율 최대" 세 안을 골라 바로 적용
5. **경제성 검토**: 설치단가, 판매 방식(고정가격 계약 또는 SMP+REC 현물, 용량·지목별 REC 가중치 참고값), 운영비·토지 임대료, 효율 감소, 융자(비율·이자율·상환·거치, 원리금균등/원금균등)로 회수기간, 자기자본·사업 IRR, NPV, 누적 현금흐름, 융자 상환표 계산

## 바로 열기

`main`에 올라가면 GitHub Actions가 빌드해서 GitHub Pages에 배포합니다: https://mooyooai.github.io/solar-layout/

처음 한 번은 저장소 Settings > Pages에서 Source를 "GitHub Actions"로 바꿔야 합니다. VWorld 키는 Settings > Secrets and variables > Actions에 `VITE_VWORLD_KEY`로 등록하고(화면에는 키 입력 칸이 없습니다), VWorld 키의 서비스 URL에는 `mooyooai.github.io`를 추가해야 합니다.

## 로컬 실행

```bash
npm install
cp .env.example .env.local   # VITE_VWORLD_KEY 입력 (선택)
npm run dev
```

VWorld 인증키는 [vworld.kr](https://www.vworld.kr)에서 무료로 발급받고, 서비스 URL에 사용할 도메인(개발 중이면 `localhost`)을 등록하세요. 키가 없으면 OpenStreetMap 배경에서 영역을 직접 그려서 쓸 수 있습니다.

## 구조

- `src/lib/vworld.ts`: VWorld 검색·데이터 API(JSONP), 배경지도·지적도 레이어 주소
- `src/lib/parcel.ts`: 필지 모델, 면적 계산
- `src/lib/geo.ts`: 필지 중심 기준 평면 좌표(m)와 도형 계산
- `src/lib/layout.ts`: 배치 변수, 세트 크기, 자동 배치
- `src/lib/sun.ts`: 태양 위치, 동지 무음영 열 이격거리
- `src/lib/shading.ts`: 그림자 다각형, 모듈 표본점 음영 판정
- `src/lib/analysis.ts`: 시각별·하루·월별 음영 묶음
- `src/lib/energy.ts`: 월별 일사량 → 경사면 일사량 → 발전량
- `src/lib/optimize.ts`, `optimize.worker.ts`: 최적 배치 탐색(웹 워커에서 실행)
- `src/components/LayoutPanel.tsx`: 배치 탭
- `src/components/ShadePanel.tsx`, `EnergyPanel.tsx`: 음영·발전량 탭

## 계산 방식

- 태양 위치: Cooper 적위, Spencer 균시차, 한국 표준시(동경 135°) 보정
- 그림자: 세트 경사면 네 꼭짓점과 장애물 윗면을 태양 반대 방향 지면으로 투영한 볼록 다각형. 모듈마다 경사면 위 두 점을 같은 방향으로 내려 다른 물체의 그림자 안에 들면 그늘로 본다.
- 발전량: 한국 평균 월별 수평면 일사량 → Erbs 산란 비율 → Collares-Pereira & Rabl 시간 분배 → 등방성 하늘 모델 경사면 일사량. 그늘진 모듈은 직달 일사를 잃는다고 보고, 성능계수(기본 0.8)를 곱한다. 문자열(스트링) 단위 전기적 손실은 반영하지 않는다.
- 최적 배치: 경사각 10~35°(5° 간격), 방위각(정남, 필지 긴 변이 ±30° 안이면 그 방향), 열 이격거리(동지 무음영 거리의 50~120%, 최소 1m 통로)를 네 계절 1시간 간격 근사로 훑은 뒤, 기준별 상위 후보 주변(경사각 ±2.5°, 첫 열 위치)을 12개월 30분 간격으로 다시 계산한다.
- 경제성: 1년차 발전량(발전량 탭의 kWh/kWp × 현재 용량, 계산 전이면 하루 발전시간 × 용량)에 해마다 효율 감소를 곱하고 판매 단가로 매출을 낸 뒤 운영비와 원리금을 뺀 자기자본 현금흐름으로 회수기간·IRR(이분법)·NPV를 구한다. 세금과 물가상승은 넣지 않는다.
- `src/lib/economics.ts`, `src/components/EconomicsPanel.tsx`: 경제성 계산과 탭
- `src/components/MapView.tsx`: OpenLayers 지도
- `src/App.tsx`: 사이드 패널
