#!/usr/bin/env python3
"""아침 시황 발행: draft.json 을 검사하고 briefing/<date>.json, latest.json, index.json 을 갱신.
사용: python3 briefing-tools/build.py draft.json   (저장소 루트에서 실행)"""
import json, sys, os, re
d = json.load(open(sys.argv[1], encoding='utf-8'))
req = ['date', 'weekday', 'generatedAt', 'headline', 'us', 'macro', 'news', 'schedule']
miss = [k for k in req if k not in d]
assert not miss, f'빠진 항목: {miss}'
assert re.match(r'^\d{4}-\d{2}-\d{2}$', d['date']), 'date 형식 YYYY-MM-DD'
assert 3 <= len(d['news']) <= 5, '뉴스는 3~5개'
for n in d['news']:
    assert n.get('title') and n.get('summary') and n.get('source') and str(n.get('url', '')).startswith('http'), f'뉴스 항목 누락: {n}'
banned = ['매수 추천', '매도 추천', '목표가', '사세요', '파세요', '무조건', '수익 보장', '원금 보장', '급등 예상', '강력 추천']
text = json.dumps(d, ensure_ascii=False)
hit = [w for w in banned if w in text]
assert not hit, f'금지 표현 포함: {hit}'
for x in d['us'] + d['macro']:
    assert x.get('name') and x.get('value'), f'지표 누락: {x}'
    x.pop('at', None)
os.makedirs('briefing', exist_ok=True)
for name in (d['date'] + '.json', 'latest.json'):
    json.dump(d, open(os.path.join('briefing', name), 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
idx_path = 'briefing/index.json'
idx = json.load(open(idx_path, encoding='utf-8')) if os.path.exists(idx_path) else {'dates': []}
dates = [x for x in idx.get('dates', []) if x != d['date']]
dates.insert(0, d['date'])
json.dump({'dates': sorted(set(dates), reverse=True)[:365]}, open(idx_path, 'w', encoding='utf-8'), ensure_ascii=False)
print('OK', d['date'], len(d['news']), 'news')
