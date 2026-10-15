# 태양광 배치 설계

지번으로 필지를 찾고, 지적도 위에 태양광 모듈을 가배치하고, 계절별 음영과 발전량을 확인하는 웹 도구입니다.

## 진행 단계

1. **지번 검색과 지적도** (완료): VWorld 주소 검색, 연속지적도 표시, 필지 경계·면적·공시지가 표시, 영역 직접 그리기
2. **모듈 가배치와 수동 편집** (완료): 모듈 규격·세트 구성·경사각·방위각, 패널 간격·세트 간격·열 이격거리·경계 이격 설정, 동지 기준 열 이격거리 추천, 자동 배치, 선택·이동·회전·추가·삭제
3. **음영 분석과 발전량** (완료): 날짜·시각별 태양 위치와 그림자(세트 간, 건물·나무 장애물), 그늘진 모듈 비율, 월별·연간 발전량과 음영 손실
4. **AI 최적 배치** (완료): 경사각·방위각·열 이격거리·첫 열 위치를 바꿔 수십 가지 배치를 만들고, 음영을 반영한 연간 발전량으로 "발전량 최대", "균형", "효율 최대" 세 안을 골라 바로 적용
5. **지형 경사·절성토 분석** (완료): 필지 표고를 자동으로 불러와 평균·최대 경사, 경사 구간 면적, 남향 비율을 계산하고, 경사면 정지(최대 경사 지정) 또는 수평 정지 기준 절토·성토량과 깊이를 지도 색으로 표시

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
- `src/lib/terrain.ts`, `terrainColors.ts`: 표고 타일 불러오기, 경사·절성토 계산, 지도 색 구간
- `src/components/LayoutPanel.tsx`: 배치 탭
- `src/components/TerrainPanel.tsx`: 지형 탭
- `src/components/MapView.tsx`: OpenLayers 지도
- `src/App.tsx`: 사이드 패널
- `src/components/ShadePanel.tsx`, `EnergyPanel.tsx`: 음영·발전량 탭

## 계산 방식

- 태양 위치: Cooper 적위, Spencer 균시차, 한국 표준시(동경 135°) 보정
- 그림자: 세트 경사면 네 꼭짓점과 장애물 윗면을 태양 반대 방향 지면으로 투영한 볼록 다각형. 모듈마다 경사면 위 두 점을 같은 방향으로 내려 다른 물체의 그림자 안에 들면 그늘로 본다.
- 발전량: 한국 평균 월별 수평면 일사량 → Erbs 산란 비율 → Collares-Pereira & Rabl 시간 분배 → 등방성 하늘 모델 경사면 일사량. 그늘진 모듈은 직달 일사를 잃는다고 보고, 성능계수(기본 0.8)를 곱한다. 문자열(스트링) 단위 전기적 손실은 반영하지 않는다.
- 최적 배치: 경사각 10~35°(5° 간격), 방위각(정남, 필지 긴 변이 ±30° 안이면 그 방향), 열 이격거리(동지 무음영 거리의 50~120%, 최소 1m 통로)를 네 계절 1시간 간격 근사로 훑은 뒤, 기준별 상위 후보 주변(경사각 ±2.5°, 첫 열 위치)을 12개월 30분 간격으로 다시 계산한다.
- 지형: AWS 공개 표고 타일(Terrarium, 한국은 SRTM 약 30m 원자료)을 줌 15로 받아 쌍선형 보간한다. 필지를 3m 격자(셀이 2만5천 개를 넘으면 키움)로 나눠 셀마다 표고와 경사·향을 구하고, 계획면은 최소제곱 평면(기울기는 최대 경사로 제한) 또는 수평면으로 두고 높이를 절토량=성토량이 되게 맞춘다. 개략 검토용이며 인허가·시공 물량은 측량 자료로 다시 산정해야 한다.
