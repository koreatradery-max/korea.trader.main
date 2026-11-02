#!/usr/bin/env python3
"""아침 시황용 시장 수치 수집 (네이버 증권 공개 API). 결과를 JSON으로 출력."""
import json, urllib.request
UA = {'User-Agent': 'Mozilla/5.0'}
def get(u):
    with urllib.request.urlopen(urllib.request.Request(u, headers=UA), timeout=15) as r: return json.load(r)
def pct(x):
    try: v = float(str(x).replace(',', ''))
    except: return ''
    return ('+' if v > 0 else '' if v < 0 else '') + f'{v:.2f}%'
out = {'us': [], 'macro': [], 'raw': {}}
for code, name in [('.INX', 'S&P 500'), ('.IXIC', '나스닥'), ('.DJI', '다우'), ('.SOX', '필라델피아 반도체')]:
    try:
        d = get(f'https://api.stock.naver.com/index/{code}/basic')
        out['us'].append({'name': name, 'value': d['closePrice'], 'chg': pct(d['fluctuationsRatio']), 'at': d.get('localTradedAt')})
    except Exception as e: out['raw'][name] = str(e)
def mi(cat, code):
    return get(f'https://m.stock.naver.com/front-api/marketIndex/productDetail?category={cat}&reutersCode={code}')['result']
specs = [('exchange', 'FX_USDKRW', '원/달러', lambda v: v + '원'),
         ('bond', 'US10YT=RR', '미 10년물', lambda v: f'{float(v):.2f}%'),
         ('energy', 'CLcv1', 'WTI', lambda v: '$' + v),
         ('metals', 'GCcv1', '금', lambda v: '$' + v)]
for cat, code, name, fmt in specs:
    try:
        r = mi(cat, code)
        item = {'name': name, 'value': fmt(r['closePrice']), 'chg': pct(r['fluctuationsRatio']), 'at': r.get('localTradedAt')}
        if cat == 'bond':  # 금리는 %p 변화로
            try:
                bp = round(float(r['fluctuations']) * 100, 1)
                item['chg'] = '보합' if abs(bp) < 0.05 else (('+' if bp > 0 else '') + f'{bp:g}bp')
            except: pass
        out['macro'].append(item)
    except Exception as e: out['raw'][name] = str(e)
try:
    d = get('https://api.upbit.com/v1/ticker?markets=USDT-BTC,KRW-BTC')
    usd = next(x for x in d if x['market'] == 'USDT-BTC')
    out['macro'].append({'name': '비트코인', 'value': f"${usd['trade_price']:,.0f}", 'chg': pct(usd['signed_change_rate'] * 100), 'at': 'upbit 24h'})
except Exception as e: out['raw']['비트코인'] = str(e)
print(json.dumps(out, ensure_ascii=False, indent=1))
