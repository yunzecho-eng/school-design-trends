# 공식 사무소·학교 건물 자료 연결

> 2026-10-28: 나이스·학교알리미·KOSIS를 추가한 공통 수집 명령은 [API 연결 순서](API_SETUP.md)를 따릅니다. 아래는 기존 2종 수집기의 기록입니다. 새 명령의 공개 출력은 연결 현황만 포함하며 원본·후보는 비공개 폴더에 보관합니다.

확인일: 2026-10-19. 키를 사용하는 요청은 로컬 수집 도구에서만 실행하고, 웹은 `public/official-enrichment.json`을 읽는다. 기존 작품집 166건을 이름만으로 외부 업체·학교와 합치지 않는다.

## 인증키가 없다면 여기서 시작하세요

**사무소 정보를 먼저 연결하려면 경기데이터드림 키 하나부터 발급받으면 됩니다.** 건물 연령용 키는 다른 기관에서 발급하는 별도 키이며 나중에 준비해도 됩니다.

1. [경기데이터드림](https://data.gg.go.kr/)에서 회원가입·로그인합니다.
2. 메뉴 **개방 → OpenAPI → 인증키발급**으로 들어갑니다. 메뉴가 달라졌거나 찾기 어려우면 [공식 발급 안내의 ‘3. 인증키 발급’](https://data.gg.go.kr/portal/openapi/usagePage.do)을 참고합니다.
3. 활용용도와 내용을 입력합니다. 이 프로젝트에는 `경기도 학교 설계 동향 연구 — 건축사사무소 공개 정보 조회`처럼 적을 수 있습니다. 활용 URL은 `https://yunzecho-eng.github.io/school-design-trends/`로 입력합니다.
4. 인증키 발급을 요청하고 발급된 값을 확인합니다. 공식 안내는 자동 발급으로 설명합니다. 이 키로 사용할 데이터는 **건축사 사무소 현황**, API 이름은 **Buildofc**입니다.
5. PC의 `D:\CLAUDE_FILE\tools\school-design-trends`에서 `.env.example`을 복사해 `.env`라는 파일로 저장합니다. 기존 `.env`가 있으면 복사해 덮어쓰지 말고 해당 파일을 편집합니다. 아래 `GG_OPEN_API_KEY=` 뒤에 발급받은 값을 넣고 저장합니다. 파일명이 `.env.txt`가 되지 않도록 확인합니다.

```dotenv
GG_OPEN_API_KEY=여기에_경기데이터드림에서_발급받은_키
DATA_GO_KR_SERVICE_KEY=
```

6. 프로젝트 폴더에서 아래 명령을 실행합니다. 키 자체는 명령에 적지 않습니다.

```powershell
Set-Location 'D:\CLAUDE_FILE\tools\school-design-trends'
node --env-file=.env scripts/enrich-official-data.mjs firms
```

성공하면 `data/private/official-firms.json`에 공식 자료의 사무소 일치 **후보**가 저장됩니다. 실행만으로 GitHub 배포 화면이 바뀌지는 않습니다. 결과를 검토하고 아래 공개용 결과 경로로 갱신·배포하는 단계가 이어집니다. `.env`는 Git 제외 대상이며, 키 값은 채팅·이슈·README에 올리지 않습니다.

건물 연령도 연결하려면 [건축HUB 건축물대장정보 서비스](https://www.data.go.kr/data/15134735/openapi.do)에 로그인해 **활용신청**을 진행합니다. 승인된 서비스의 일반 인증키 **Decoding** 값을 같은 `.env`의 `DATA_GO_KR_SERVICE_KEY=` 뒤에 저장합니다. 이 키는 경기데이터드림 키와 서로 바꿔 쓸 수 없습니다. 건물 조회에는 키 외에도 확인된 학교별 지번 목록이 필요하며, 준비 방법은 아래 ‘건물’ 항목에 설명했습니다.

## 이번에 연결한 범위

| 자료 | 실제 확인 | 현재 웹 상태 |
|---|---|---|
| 경기 건축사 사무소 API | 키 없이 5건 정상 응답, 응답의 전체 건수 3,421건. 이 5건과 작품집 사무소 76개의 이름이 일치하는 후보는 없음 | `sample_only`, `complete: false`. 76개는 `not_searched`; 전체 미검색을 업체 없음으로 쓰지 않음 |
| 건축HUB 건축물대장 표제부 | 공식 현행 명세의 사용승인일·동명·대장 식별자 확인. 인증 없는 요청은 HTTP 401 | `key_and_parcel_required`; 건물 후보·연령을 만들지 않음 |
| 경기 공식 CSV 내려받기 | 포털의 정식 `downloadSheetData.do` 경로도 확인했으나 요청 시 오류 페이지 반환. 기본정보 페이지도 중간에서 끊겨 내려받기 완료 못 함 | 파일 수집·전체 조회 성공으로 기록하지 않음 |

사무소 API의 3,421건은 **API가 알려 준 전체 건수**이며 내려받은 건수는 5건이다. 샘플의 `DATA_STD_DE`는 비어 있으므로 조회일로 자료 기준일을 채우지 않았다. 월별 자동 실행은 설정하지 않았다.

## 사무소: 경기데이터드림

- [공식 데이터 안내](https://www.data.go.kr/data/15057636/openapi.do)
- [공식 API 명세](https://data.gg.go.kr/portal/data/openapi/selectOpenApiMeta.do?infId=7VV6IWKWGKZFH3PG0ELH19127436&infSeq=2)
- [인증키 발급·사용 방법](https://data.gg.go.kr/portal/openapi/usagePage.do)
- 요청 주소: `https://openapi.gg.go.kr/Buildofc`

현재 API의 필드는 `OFC_NM`, `SIGUN_CD`, `SIGUN_NM`, `STATMNT_DIV`, `REPRSNTV_NM`, `REFINE_ROADNM_ADDR`, `REFINE_LOTNO_ADDR`, `REFINE_ZIP_CD`, 좌표, `DATA_STD_DE`다. 포털의 Sheet 화면 명세와 API 필드가 다르므로 API에 없는 신고번호·신고일자를 생성하지 않는다. 사업자등록번호·회사 홈페이지·현재 영업상태도 제공되지 않는다. 신고구분(개인/법인)은 영업상태가 아니다.

공식 이용조건은 ‘이용허락범위 제한 없음’이다. 회사명·주소 같은 공개 사업장 필드만 정규화하며, 당선 여부는 원래 작품집 근거를 유지한다. 경기 소재 사무소 자료라서 서울 등 다른 지역 업체가 경기 학교를 설계한 경우에는 조회되지 않을 수 있다.

전체 조회에는 경기데이터드림 계정으로 인증키를 발급받아 로컬 `.env`의 `GG_OPEN_API_KEY`에 저장해야 한다. 채팅·HTML·공개 JSON에 키를 넣지 않는다. 키 없는 시험은 `KEY` 인자를 **생략**한다. 현재 `KEY=sample`을 직접 넣으면 `ERROR-290`이 돌아온다.

```powershell
# .env.example을 참고해 로컬 .env에 키를 저장한 뒤 실행
node --env-file=.env scripts/enrich-official-data.mjs firms

# 인증키 없이 통신·형식만 확인 (전체 수집 아님)
node scripts/enrich-official-data.mjs firms --sample

# 공개할 후보·상태 파일을 확인한 뒤 웹에서 읽는 경로로 저장
node --env-file=.env scripts/enrich-official-data.mjs firms --out public/official-enrichment.json
```

기본 출력은 Git 제외 경로 `data/private/official-firms.json`이다. 전체 API 응답을 페이지별로 받고 총건수·중복 페이지·응답 형식을 확인한다. 실패하면 이전 결과를 덮어쓰지 않는다. 출처와 조회일은 결과에 보존하지만 요청 URL의 키와 응답 오류 원문은 출력하지 않는다.

정규화는 법인 표기와 공백에 한정한다. 사무소명의 일부만 같다고 연결하지 않는다. 한 후보는 `candidate`, 동명 후보가 여럿이면 `ambiguous`이며 모두 `verified: false`다. 주소·대표자·변경 이력을 사람이 대조한 뒤 실제 사무소에 연결해야 한다. 검증 없이 원본 `firm_ids`나 사업자번호를 바꾸지 않는다.

## 건물: 건축HUB 표제부 + 학교 식별·지번

[국토교통부 공식 안내·명세](https://www.data.go.kr/data/15134735/openapi.do)의 현재 요청 주소는 `https://apis.data.go.kr/1613000/BldRgstHubService/getBrTitleInfo`다. 무료·월간 갱신으로 안내되어 있고 활용신청/키가 필요하다. 일반 인증키(Decoding)를 `.env`의 `DATA_GO_KR_SERVICE_KEY`에 저장한다.

확인된 학교별 `school_id`와 시군구코드·법정동코드·대지구분·본번/부번이 입력이다. 예시 코드를 실제 학교로 사용하지 말고, 학교 주소와 지적 주소를 대조해 `data/private/school-parcels.json` 배열을 작성한다. 각 항목의 형식은 다음과 같다.

```json
{
  "school_id": "확인된 학교 식별자",
  "sigunguCd": "경기 5자리 시군구코드",
  "bjdongCd": "5자리 법정동코드",
  "platGbCd": "0",
  "bun": "4자리 본번",
  "ji": "4자리 부번"
}
```

```powershell
node --env-file=.env scripts/enrich-official-data.mjs buildings --parcels data/private/school-parcels.json
```

도구는 응답의 필지가 입력과 같은지 확인하고 `mgmBldrgstPk`(건물대장 식별자), `dongNm`(동명), `useAprDay`(사용승인일)를 **검토용 후보**로 보존한다. 잘못된 날짜·미확인·미래 날짜는 연령 입력으로 쓰지 않는다. 서로 다른 동을 학교 한 건으로 합치지 않으며, 조회되지 않은 건물을 철거로 간주하지 않는다. 학교 소속·동·현존 여부와 사용승인일의 의미를 검토하기 전에는 작품집 Snapshot에 자동 병합하지 않는다.

학교코드·학교명·주소의 연결에는 [나이스 학교기본정보](https://open.neis.go.kr/portal/data/service/selectServicePage.do?infId=OPEN17020190531110010104913&infSeq=2) 또는 [전국초중등학교위치표준데이터](https://www.data.go.kr/data/15021148/standard.do)를 사용할 수 있다. 이 자료의 설립일·개교일은 건물 준공일이 아니다. 현재 작품집의 임시 학교명과 학교 ID, 개축 전후 건물 관계가 연결되지 않아 아직 실제 40년 이상 건물을 계산하지 않았다.

## 웹용 결과 형식과 검증

`services.firms`와 `services.buildings`에 상태·출처·확인일·수집 범위를 기록한다. `complete`는 해당 요청 범위의 수집 완결성이고 사람의 검증 완료가 아니다. `firm_matches`는 작품집 `firm_id`별 후보, `building_candidates`는 조회한 지번의 동별 후보다. 한 종류를 갱신할 때 다른 종류의 기존 결과는 유지한다.

자동 테스트는 이름 중복·짧은 부분 이름·법인 표기, 결측 보존, 인증키 누출 방지, 샘플 한계, 페이지 반복/총건수 변경, 경기 밖 코드, 필지 불일치, 잘못된 사용승인일·미래 날짜·서로 다른 동을 확인한다. 실제 서비스의 전체 자료와 건물 레코드 수집은 키 등록 이후에 추가 검증한다.
