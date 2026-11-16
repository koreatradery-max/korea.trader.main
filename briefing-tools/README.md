# 아침 시황 도구

- `market.py`: 미국 지수·환율·금리·원자재·비트코인 수치를 네이버 증권/업비트 공개 API에서 받아 JSON으로 출력
- `build.py`: 작성한 시황(draft.json)을 검사(필수 항목·금지 표현)하고 `briefing/<날짜>.json`, `latest.json`, `index.json`을 갱신

- 아침 시황: 월~토 08:07 예약 작업이 `briefing/<날짜>.json`·`latest.json`을 올리고, 08:50에 Cloudflare Worker가 로그인 회원에게 텔레그램으로 보냅니다.
- 미국장 시황: 평일 21:17 예약 작업이 `python3 briefing-tools/market.py --us`, `build.py draft.json --us`로 `briefing/us-*.json`을 올리고, 22:00에 Worker가 보냅니다.

## 지난 시황 페이지 (v38)

- `archive.py`: `briefing/*.json` 을 읽어 `briefing/archive/<날짜>.html`, `briefing/archive/index.html`, `sitemap.xml` 을 다시 만듭니다. `build.py` 가 끝날 때 자동으로 실행됩니다.
- 예약 작업이 커밋할 때 `briefing/archive/` 와 `sitemap.xml` 도 함께 올려야 지난 시황 페이지가 갱신됩니다 (`git add briefing sitemap.xml`).
- 로그인 전 화면과 같은 범위(한 줄 요약·지수·일정)만 싣습니다.

## 그 밖의 데이터 파일 (v38)

- `assets/data/glossary.json`: 용어 사전. 항목을 추가하면 `glossary.html` 과 시황 본문 툴팁에 함께 반영됩니다.
- `assets/data/course.json`: 7일 코스 본문.
- `assets/data/outlook.json`: 전망과 결과 기록. `items` 에 `{"date":"2026-11-02","source":"11/2 라이브","call":"말한 내용","result":"적중|빗나감|진행 중","outcome":"실제 결과"}` 형식으로 추가합니다.
