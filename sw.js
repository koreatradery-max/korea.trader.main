/* STOCK PICK! 서비스 워커
   - 화면(HTML): 항상 네트워크 우선, 실패했을 때만 저장본 사용 → 새 버전이 바로 보인다.
   - assets/ 정적 파일: 저장본을 먼저 쓰고 뒤에서 갱신.
   - 그 밖의 요청(Firebase, Worker API, 시황 JSON, 외부 위젯)은 건드리지 않는다.
   문제가 생기면 이 파일의 fetch 리스너를 비우고 VERSION 만 올려 배포하면 저장본이 정리된다. */
var VERSION = 'sp-v38-2';
self.addEventListener('install', function(e){ self.skipWaiting(); });
self.addEventListener('activate', function(e){
  e.waitUntil(caches.keys().then(function(keys){ return Promise.all(keys.filter(function(k){ return k !== VERSION; }).map(function(k){ return caches.delete(k); })); }).then(function(){ return self.clients.claim(); }));
});
self.addEventListener('fetch', function(e){
  var req = e.request;
  if (req.method !== 'GET') return;
  var url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (req.mode === 'navigate'){
    e.respondWith(fetch(req).then(function(res){
      if (res && res.ok){ var copy = res.clone(); caches.open(VERSION).then(function(c){ c.put(req, copy); }); }
      return res;
    }).catch(function(){ return caches.match(req).then(function(hit){ return hit || caches.match(new URL('./', self.registration.scope).href); }); }));
    return;
  }
  if (url.pathname.indexOf('/assets/') >= 0){
    e.respondWith(caches.open(VERSION).then(function(c){
      return c.match(req).then(function(hit){
        var net = fetch(req).then(function(res){ if (res && res.ok) c.put(req, res.clone()); return res; }).catch(function(){ return hit; });
        return hit || net;
      });
    }));
  }
});
