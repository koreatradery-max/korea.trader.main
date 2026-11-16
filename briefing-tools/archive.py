#!/usr/bin/env python3
"""지난 시황 정적 페이지 생성: briefing/*.json 을 읽어 briefing/archive/<이름>.html, briefing/archive/index.html,
sitemap.xml 을 다시 만든다. build.py 가 끝날 때 자동으로 실행되며, 단독 실행도 가능하다.
사용: python3 briefing-tools/archive.py   (저장소 루트에서 실행)
로그인 전 화면과 같은 범위(한 줄 요약, 지수, 일정)만 싣고 뉴스 본문은 사이트 로그인 화면으로 연결한다."""
import json, os, glob, html, re

BASE = 'https://koreatradery-max.github.io/korea.trader.main/'
LOGO = 'assets/img/logo-4a0113b7bb.png'
OUT = 'briefing/archive'
NAV = [('index.html', '홈'), ('index.html#briefing', '시황'), ('briefing/archive/', '지난 시황'), ('week.html', '이번 주 일정'),
       ('glossary.html', '용어 사전'), ('course.html', '7일 코스'), ('outlook.html', '전망과 결과'), ('more.html', '검색 · 더보기')]
E = lambda s: html.escape(str(s if s is not None else ''), quote=True)


def chg(c):
    s = str(c or '').strip()
    if not s:
        return '', 'flat'
    if s.startswith('-'):
        return '▼ ' + s[1:], 'dn'
    if re.match(r'^\+?0(\.0+)?\s*(%|bp)?$', s):
        return s.replace('+', ''), 'flat'
    return '▲ ' + s.replace('+', ''), 'up'


def shell(path, title, desc, body, cur='briefing/archive/'):
    root = '../../'
    nav = ''.join('<a href="%s%s"%s>%s</a>' % (root, h, ' aria-current="page"' if h == cur else '', t) for h, t in NAV)
    return f'''<!doctype html>
<html lang="ko" data-root="{root}">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{E(title)} | STOCK PICK!</title>
<meta name="description" content="{E(desc)}">
<link rel="canonical" href="{BASE}{path}">
<meta property="og:type" content="article">
<meta property="og:site_name" content="STOCK PICK!">
<meta property="og:title" content="{E(title)}">
<meta property="og:description" content="{E(desc)}">
<meta property="og:url" content="{BASE}{path}">
<meta property="og:image" content="{BASE}assets/img/og.png">
<meta name="twitter:card" content="summary_large_image">
<meta name="theme-color" content="#08090B">
<link rel="icon" type="image/png" href="{root}{LOGO}">
<link rel="manifest" href="{root}manifest.webmanifest">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans+KR:wght@400;500;600;700&display=swap" rel="stylesheet">
<link rel="stylesheet" href="{root}assets/pages.css">
</head>
<body>
<header class="pg-head"><div class="pg-head-in">
<a class="pg-brand" href="{root}index.html"><img src="{root}{LOGO}" alt="" width="260" height="185">STOCK PICK!</a>
<nav class="pg-nav" aria-label="메뉴">{nav}</nav>
</div></header>
<main class="pg-wrap">
{body}
</main>
<footer class="pg-foot"><div class="pg-foot-in">본 시황은 공개된 자료를 바탕으로 AI가 정리한 정보 제공 목적의 글이며, 매수·매도 추천이나 개인별 투자자문이 아닙니다. 수치는 작성 시점 기준이며 출처의 원문과 다를 수 있습니다. 투자 판단과 책임은 투자자 본인에게 있습니다. · <a href="{root}index.html">STOCK PICK! 홈</a></div></footer>
<script src="{root}assets/pages.js"></script>
</body>
</html>
'''


def label(d):
    y, m, dd = d['date'].split('-')
    kind = '미국장 시황' if d.get('kind') == 'us' else '아침 시황'
    return f"{int(m)}월 {int(dd)}일({d.get('weekday', '')}) {kind}", kind, y


def main():
    os.makedirs(OUT, exist_ok=True)
    docs = []
    for f in sorted(glob.glob('briefing/*.json')):
        name = os.path.basename(f)[:-5]
        if not re.match(r'^(us-)?\d{4}-\d{2}-\d{2}$', name):
            continue
        try:
            d = json.load(open(f, encoding='utf-8'))
        except Exception:
            continue
        if not d.get('date') or not d.get('headline'):
            continue
        d.setdefault('kind', 'us' if name.startswith('us-') else 'morning')
        docs.append((name, d))
    # 최신순: 날짜 내림차순, 같은 날은 미국장(밤)이 위
    docs.sort(key=lambda x: (x[1]['date'], 1 if x[1]['kind'] == 'us' else 0), reverse=True)
    for i, (name, d) in enumerate(docs):
        lab, kind, year = label(d)
        cards = ''
        for x in d.get('us', []):
            t, c = chg(x.get('chg'))
            cards += f'<div class="card stat rv"><div class="k">{E(x.get("name"))}</div><div class="v">{E(x.get("value"))}</div><div class="c {c}">{E(t)}</div></div>'
        sched = ''.join(f'<li class="row"><span class="t">{E(s.get("time"))}</span><span>{E(s.get("text"))}</span></li>' for s in d.get('schedule', []))
        newer = docs[i - 1] if i > 0 else None
        older = docs[i + 1] if i + 1 < len(docs) else None
        pn = ''
        if older:
            pn += f'<a class="card link-card" href="{older[0]}.html"><div class="d">이전</div><b>{E(label(older[1])[0])}</b></a>'
        if newer:
            pn += f'<a class="card link-card" href="{newer[0]}.html"><div class="d">다음</div><b>{E(label(newer[1])[0])}</b></a>'
        hash_kind = 'us' if d['kind'] == 'us' else 'morning'
        n_news = len(d.get('news', []))
        body = f'''<nav class="pg-crumb" aria-label="경로"><a href="./">지난 시황</a> / {E(year)}년 / {E(lab)}</nav>
<h1>{E(d['headline'])}</h1>
<p class="muted small">{E(lab)} · STOCK PICK! · AI가 공개 자료를 바탕으로 정리</p>
<h2>{'미국장 개장 전 지표' if d['kind'] == 'us' else '밤사이 미국 증시'}</h2>
<div class="grid c4">{cards}</div>
{('<h2>일정 (한국 시간)</h2><div class="card"><ul class="list">' + sched + '</ul></div>') if sched else ''}
<h2>환율 · 금리 · 뉴스 {n_news}건</h2>
<div class="gate"><div><b>전체 시황은 로그인 후 무료로 볼 수 있습니다</b><div class="muted small">환율·금리·원자재와 체크할 뉴스 {n_news}건을 정리했습니다. 로그인하면 매일 텔레그램으로도 받습니다.</div></div><a class="btn" href="../../index.html#briefing/{hash_kind}">전체 시황 보기</a></div>
<div class="grid c2" style="margin-top:28px">{pn}</div>
<p class="small muted" style="margin-top:20px">모르는 용어가 있다면 <a href="../../glossary.html">용어 사전</a>을 참고하세요.</p>'''
        open(f'{OUT}/{name}.html', 'w', encoding='utf-8').write(shell(f'{OUT}/{name}.html', f'{lab}: {d["headline"]}', d['headline'], body))
    rows = ''
    month = None
    for name, d in docs:
        lab, kind, year = label(d)
        mkey = d['date'][:7]
        if mkey != month:
            if month is not None:
                rows += '</div>'
            month = mkey
            rows += f'<h2>{int(mkey[:4])}년 {int(mkey[5:])}월</h2><div class="grid">'
        rows += f'<a class="card link-card rv" href="{name}.html"><span class="tag{" lime" if kind == "아침 시황" else ""}">{E(lab)}</span><h3 style="margin-top:8px">{E(d["headline"])}</h3></a>'
    if month is not None:
        rows += '</div>'
    body = f'''<h1>지난 시황</h1>
<p class="lead">매일 아침 08:50, 밤 22:00에 발행한 시황을 날짜별로 모았습니다. 현재 {len(docs)}건.</p>
{rows or '<div class="empty">아직 발행된 시황이 없습니다.</div>'}'''
    open(f'{OUT}/index.html', 'w', encoding='utf-8').write(shell(f'{OUT}/', '지난 시황 모음', '매일 아침과 밤에 발행한 미국 증시·환율·금리 시황을 날짜별로 모았습니다.', body))
    urls = ['', 'glossary.html', 'course.html', 'week.html', 'outlook.html', 'more.html', f'{OUT}/'] + [f'{OUT}/{n}.html' for n, _ in docs]
    sm = '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n'
    lastmod = {f'{OUT}/{n}.html': d['date'] for n, d in docs}
    for u in urls:
        sm += f'  <url><loc>{BASE}{u}</loc>' + (f'<lastmod>{lastmod[u]}</lastmod>' if u in lastmod else '') + '</url>\n'
    sm += '</urlset>\n'
    open('sitemap.xml', 'w', encoding='utf-8').write(sm)
    print('archive OK', len(docs), 'pages')


if __name__ == '__main__':
    main()
