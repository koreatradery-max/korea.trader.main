# 아침 시황 도구

- `market.py`: 미국 지수·환율·금리·원자재·비트코인 수치를 네이버 증권/업비트 공개 API에서 받아 JSON으로 출력
- `build.py`: 작성한 시황(draft.json)을 검사(필수 항목·금지 표현)하고 `briefing/<날짜>.json`, `latest.json`, `index.json`을 갱신

- 아침 시황: 월~토 08:07 예약 작업이 `briefing/<날짜>.json`·`latest.json`을 올리고, 08:50에 Cloudflare Worker가 로그인 회원에게 텔레그램으로 보냅니다.
- 미국장 시황: 평일 21:17 예약 작업이 `python3 briefing-tools/market.py --us`, `build.py draft.json --us`로 `briefing/us-*.json`을 올리고, 22:00에 Worker가 보냅니다.
