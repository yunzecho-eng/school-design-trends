# 공식 API 연결 순서

작성·수정: yunze · 확인일: 2026-10-28

5개 API 수집기를 로컬에서 실행합니다. 인증키와 수집 원본은 Git 제외 경로에 두며, 공개 사이트는 키가 없는 연결 현황만 읽습니다. API 조회 성공과 학교·사무소의 동일성 검토 완료는 별개입니다. 기존 작품집 166건은 자동 수정하지 않습니다.

## 지금 확인한 범위

| API | 실제 연결 확인 | 전체 조회에 필요한 것 |
|---|---|---|
| 나이스 학교기본정보 | 무인증 표본 5행 수신 | `NEIS_API_KEY` |
| 학교알리미 | 경기 초·중·고 × 5항목, 15요청·300 표본 레코드 수신 | `SCHOOLINFO_API_KEY`, 공시연도 |
| 경기데이터드림 사무소 | 무인증 표본 5행 수신 | `GG_OPEN_API_KEY` |
| 건축HUB 건축물대장 | 수집기·응답 검증 테스트 완료, 실제 인증 조회 전 | `DATA_GO_KR_SERVICE_KEY`, 확인된 학교 지번 |
| KOSIS 인구 | 수집기·응답 검증 테스트 완료, 실제 인증 조회 전 | `KOSIS_API_KEY`, 공식 분류 코드 설정 |

학교알리미 300건은 학교 300곳이 아닙니다. 같은 학교의 기본정보·학생·교실·지원시설·개방 정보가 별도 레코드입니다. 샘플을 전체 통계로 집계하지 않습니다. 전체 조회와 인증 후의 응답 검증은 키 등록 후 진행합니다.

## 1. 나이스부터 시작

1. [나이스 교육정보 개방 포털](https://open.neis.go.kr/)에 로그인하고 인증키 발급 메뉴에서 신청합니다. [사용할 학교기본정보](https://open.neis.go.kr/portal/data/service/selectServicePage.do?infId=OPEN17020190531110010104913&infSeq=2)는 경기도교육청 코드 `J10`으로 조회합니다.
2. 프로젝트 폴더의 `.env`를 열고 `NEIS_API_KEY=` 오른쪽에 키를 저장합니다. `.env`가 없으면 `.env.example`을 복사합니다. 기존 `.env`를 덮어쓰지 않습니다. 키를 채팅이나 GitHub에 붙이지 않습니다.
3. 프로젝트 폴더에서 실행합니다.

```powershell
npm run data:connect -- status
npm run data:connect -- neis
```

학교 코드·정식 명칭·주소·홈페이지를 수집합니다. 공백만 정규화한 정확한 이름 일치는 `candidate`이며, 예정 학교명·개명·동명 학교는 주소와 출처를 대조해야 합니다. 학교 설립일·개교기념일은 건물 사용승인일이 아닙니다.

## 2. 학교알리미

[공식 이용안내](https://www.schoolinfo.go.kr/ng/go/pnnggo_a01_m0.do)에서 SNS 로그인 → 사용자 구분·사용목적 등록 → 인증키 발급을 진행하고 `.env`의 `SCHOOLINFO_API_KEY`에 저장합니다. [제공목록](https://www.schoolinfo.go.kr/ng/go/pnnggo_a01_l0.do)을 기준으로 경기 `41`, 초등 `02`·중등 `03`·고등 `04`를 조회합니다.

```powershell
npm run data:connect -- schoolinfo --year 2025
```

기본정보(0), 학생·학급(62), 교실(17), 지원시설(18), 시설개방(20)을 수집합니다. 기본정보는 조회 시점 자료이고, 나머지는 지정 공시연도 자료입니다. 특수·각종·기타학교는 이번 수집 범위에서 제외합니다. `52(5)` 같은 학생 수는 **전체 52명에 괄호 5명이 포함**된 값으로 보존합니다. 공시 제외·미제공·시설 없음·미개방·0은 구분합니다. 학교알리미 학교코드를 나이스 코드와 같다고 가정하지 않습니다.

## 3. 경기 사무소

[경기데이터드림 발급 안내](https://data.gg.go.kr/portal/openapi/usagePage.do)에서 인증키를 발급받고 `.env`의 `GG_OPEN_API_KEY`에 저장합니다. [건축사 사무소 현황](https://www.data.go.kr/data/15057636/openapi.do)의 API 이름은 `Buildofc`입니다.

```powershell
npm run data:connect -- firms
```

이름·주소·신고 구분을 수집합니다. 사업자번호·홈페이지·현재 영업 상태는 제공하지 않습니다. 경기 학교를 설계한 서울 소재 업체는 빠질 수 있습니다. 이름 후보는 주소와 등록정보를 대조하기 전까지 동일 사무소로 확정하지 않습니다.

## 4. 건물 연령

[건축HUB 건축물대장정보 서비스](https://www.data.go.kr/data/15134735/openapi.do)를 활용신청하고 일반 인증키 **Decoding** 값을 `.env`의 `DATA_GO_KR_SERVICE_KEY`에 저장합니다.

학교와 지번을 확인한 뒤 `data/private/school-parcels.json` 배열을 작성합니다. 다음 값은 형식 설명이며 실재 학교 데이터가 아닙니다.

```json
[
  {
    "school_id": "확인한 학교 ID",
    "sigunguCd": "경기 5자리 시군구코드",
    "bjdongCd": "5자리 법정동코드",
    "platGbCd": "0",
    "bun": "4자리 본번",
    "ji": "4자리 부번",
    "reviewed": true,
    "source_url": "학교 주소와 지번을 대조한 공식 HTTPS 출처"
  }
]
```

```powershell
npm run data:connect -- buildings --parcels data/private/school-parcels.json
```

요청한 지번의 건물대장 식별자·동명·사용승인일을 수집합니다. 학교 소속·동·현존 여부를 검토해야 연령 집계에 반영할 수 있습니다. 이 요청은 경기도 모든 학교 건물을 찾는 검색이 아닙니다. 학교별 여러 동을 하나의 개교 연도로 합치지 않습니다.

## 5. KOSIS 인구

[KOSIS 공유서비스](https://kosis.kr/openapi/)에서 활용신청하고 `.env`의 `KOSIS_API_KEY`에 저장합니다. [공식 개발 가이드](https://kosis.kr/openapi/devGuide/devGuide_0201List.do)의 URL 생성기에서 기관 `101`, 표 `DT_1B04006`(행정구역별·1세별 주민등록인구)을 선택합니다.

`data/config/kosis-population.example.json`을 `data/private/kosis-population.json`으로 복사한 뒤, 선택한 경기 시·군·6–17세·남녀 합계 항목의 **실제 코드와 분류축**을 대조해 채웁니다. 지도 코드와 KOSIS 코드를 동일하다고 추정하지 않습니다. 설정 형식:

- `dimensions`: 지역/연령 축(`C1`~`C8` 중 실제 축).
- `regions`: `{code, name, level: "municipality"}` 배열. 시 전체와 하위 구를 섞지 않습니다.
- `ages`: `{code, age}` 배열. 6~17세를 각각 지정합니다.
- `item`: `{code, name, meaning: "total_resident_population"}`.
- `fixedSelections`: 다른 분류가 있으면 축별 합계 코드 하나.
- `months`: 비교할 `YYYYMM` 목록. 예제는 같은 9월의 세 연도입니다.
- 코드·경계를 확인한 후 `verified: true`, `verified_at`, 확인 메모를 기록합니다. 예제를 그대로 실행하면 조회를 거부합니다.

```powershell
npm run data:connect -- kosis --config data/private/kosis-population.json
```

인구는 재학생 수나 미래 예측이 아닙니다. 행정구역 변경은 동일 경계인지 확인하고, 결측을 0으로 채우지 않습니다. 예제 코드는 의도적으로 비워 두었으며 인증키가 든 URL 전체를 설정에 넣지 않습니다.

## 실행·검토·공개

```powershell
# 키 없이 지원되는 세 API의 실제 시험 응답 확인
npm run data:connect -- all --sample --year 2025

# 키와 추가 설정이 갖춰진 기관을 순서대로 수집
npm run data:connect -- all --year 2025 --parcels data/private/school-parcels.json --config data/private/kosis-population.json

# 성공·실패·인증키 존재 여부만 확인 (키 값 출력 없음)
npm run data:connect -- status

# 검토 후 공개할 연결 상태 JSON 생성 (원본·후보·키는 포함하지 않음)
npm run data:connect -- publish-status
```

수집 결과는 `data/private/api-connections.json`에 모입니다. `school_registry`·`school_matches`, `schoolinfo_records`, `firm_matches`, `building_candidates`, `population_records`를 검토합니다. 전용 저장소에 보관하므로 대규모 학교 목록을 기존 1,000행 제한 Snapshot에 무리하게 넣지 않습니다. 한 기관 실패 시 다른 기관을 계속 처리하며, 해당 기관의 이전 성공 데이터는 보존하고 최신 실패 상태를 따로 기록합니다. 키/추가 설정 부족은 종료코드 2, 요청 실패는 1입니다.

`publish-status`는 `public/official-enrichment.json`에 **허용한 상태 필드만** 기록합니다. 전체 응답과 연결 후보는 공개하지 않습니다. 기존의 이 파일을 사용하는 별도 후보 공개 작업이 있었다면 해당 후보 배열은 이 명령의 출력에 포함되지 않습니다. 이 명령 자체로 GitHub에 push하거나 사이트를 배포하지 않습니다. 자동 정기 실행도 아직 설정하지 않았습니다.

다음 단계는 인증 조회 → 학교/사무소 동일성 대조 → 검토한 엔터티와 출처 연결 → 학생·시설·인구 비교 화면입니다. 인증키 등록만으로 작품집의 누락 태그나 건물 연령이 자동 확정되는 것은 아닙니다.
