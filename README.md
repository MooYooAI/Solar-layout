# 태양광 배치 설계

지번으로 필지를 찾고, 지적도 위에 태양광 모듈을 가배치하고, 계절별 음영과 발전량을 확인하는 웹 도구입니다.

## 진행 단계

1. **지번 검색과 지적도** (완료): VWorld 주소 검색, 연속지적도 표시, 필지 경계·면적·공시지가 표시, 영역 직접 그리기
2. 모듈 가배치와 수동 편집: 모듈 간격, 세트 간격, 경계 이격거리 설정
3. 음영 분석과 발전량: 동지·춘추분·하지 태양 궤적, 연간·월별 발전량
4. AI 최적 배치

## 실행

```bash
npm install
cp .env.example .env.local   # VITE_VWORLD_KEY 입력 (선택)
npm run dev
```

VWorld 인증키는 [vworld.kr](https://www.vworld.kr)에서 무료로 발급받고, 서비스 URL에 사용할 도메인(개발 중이면 `localhost`)을 등록하세요. `.env.local` 대신 화면의 "VWorld 인증키 설정"에 입력해도 됩니다. 키가 없으면 OpenStreetMap 배경에서 영역을 직접 그려서 쓸 수 있습니다.

## 구조

- `src/lib/vworld.ts`: VWorld 검색·데이터 API(JSONP), 배경지도·지적도 레이어 주소
- `src/lib/parcel.ts`: 필지 모델, 면적 계산
- `src/components/MapView.tsx`: OpenLayers 지도
- `src/App.tsx`: 사이드 패널
