/* STOCK PICK! 추가 효과: 카드 기울기, 숫자 카운트, 스크롤 진행 표시, 시황 용어 툴팁, 서비스 워커 등록.
   기존 index.html 스크립트와 독립적으로 동작하며, 여기서 오류가 나도 본 기능에는 영향을 주지 않는다. */
(function(){
  'use strict';
  var mm = window.matchMedia ? function(q){ return matchMedia(q).matches; } : function(){ return false; };
  var reduce = mm('(prefers-reduced-motion: reduce)');
  var fine = mm('(hover: hover) and (pointer: fine)');
  function safe(fn){ try{ fn(); }catch(e){ if (window.console) console.warn('[plus]', e); } }

  /* 1. 카드 기울기 (PC, 마우스 사용 시에만) */
  safe(function(){
    if (reduce || !fine) return;
    var SEL = '.hx-grid .hx-card, .top3-card', cur = null, raf = 0, ev = null;
    function reset(el){ if (!el) return; el.style.transition = 'transform .35s ease'; el.style.transform = ''; el.classList.remove('sp-tilt'); setTimeout(function(){ if (el !== cur) el.style.transition = ''; }, 380); }
    function apply(){
      raf = 0; if (!cur || !ev) return;
      var r = cur.getBoundingClientRect(); if (!r.width || !r.height) return;
      var x = (ev.clientX - r.left) / r.width - 0.5, y = (ev.clientY - r.top) / r.height - 0.5;
      cur.style.transition = 'transform .12s ease-out';
      cur.style.transform = 'perspective(900px) rotateX(' + (-y * 3).toFixed(2) + 'deg) rotateY(' + (x * 3).toFixed(2) + 'deg) translateZ(0)';
    }
    document.addEventListener('pointermove', function(e){
      if (e.pointerType && e.pointerType !== 'mouse') return;
      var el = e.target && e.target.closest ? e.target.closest(SEL) : null;
      if (el !== cur){ reset(cur); cur = el; if (cur) cur.classList.add('sp-tilt'); }
      if (!cur) return;
      ev = e; if (!raf) raf = requestAnimationFrame(apply);
    }, { passive:true });
    document.addEventListener('pointerleave', function(){ reset(cur); cur = null; });
    window.addEventListener('blur', function(){ reset(cur); cur = null; });
  });

  /* 2. 숫자 카운트 (홈 이용자·누적 방문) */
  safe(function(){
    if (reduce || !('MutationObserver' in window)) return;
    ['hsUsers', 'hsJournal'].forEach(function(id){
      var el = document.getElementById(id); if (!el) return;
      var busy = false, done = false;
      var mo = new MutationObserver(function(){
        if (busy || done) return;
        var txt = (el.textContent || '').trim();
        var m = txt.match(/^([\d,]+)(.*)$/); if (!m) return;
        var target = parseInt(m[1].replace(/,/g, ''), 10); if (!(target > 0)) return;
        done = true; busy = true;
        var suffix = m[2] || '', t0 = null, dur = 900;
        function step(t){
          if (t0 === null) t0 = t;
          var p = Math.min(1, (t - t0) / dur), e = 1 - Math.pow(1 - p, 3);
          el.textContent = Math.round(target * e).toLocaleString('en-US') + suffix;
          if (p < 1) requestAnimationFrame(step); else { el.textContent = txt; busy = false; mo.disconnect(); }
        }
        requestAnimationFrame(step);
      });
      mo.observe(el, { childList:true, characterData:true, subtree:true });
    });
  });

  /* 3. 스크롤 진행 표시 (긴 화면에서만 보임) */
  safe(function(){
    if (reduce) return;
    var bar = document.createElement('div'); bar.className = 'sp-progress'; bar.setAttribute('aria-hidden', 'true'); document.body.appendChild(bar);
    var tick = false;
    function upd(){ tick = false; var h = document.documentElement.scrollHeight - window.innerHeight; bar.style.transform = 'scaleX(' + (h > 600 ? Math.min(1, window.scrollY / h) : 0) + ')'; }
    window.addEventListener('scroll', function(){ if (!tick){ tick = true; requestAnimationFrame(upd); } }, { passive:true });
    window.addEventListener('hashchange', function(){ setTimeout(upd, 60); });
  });

  /* 4. 순위 목록 행 등장 효과 */
  safe(function(){
    if (reduce || !('MutationObserver' in window)) return;
    ['boardRows'].forEach(function(id){
      var box = document.getElementById(id); if (!box) return;
      var first = true;
      new MutationObserver(function(){
        if (!first) return; if (!box.children.length) return; first = false;
        Array.prototype.forEach.call(box.children, function(r, i){ if (i < 12){ r.classList.add('sp-row-in'); r.style.animationDelay = (i * 45) + 'ms'; } });
      }).observe(box, { childList:true });
    });
  });

  /* 5. 시황 본문 용어 툴팁 */
  safe(function(){
    var art = document.getElementById('bfArticle'); if (!art || !('MutationObserver' in window)) return;
    var terms = null, loading = false, pop = null, mo = null, timer = 0;
    function esc(s){ return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
    function load(cb){
      if (terms) return cb(); if (loading) return; loading = true;
      fetch('assets/data/glossary.json').then(function(r){ return r.json(); }).then(function(d){
        var map = {}, keys = [];
        d.terms.forEach(function(x){ [x.t].concat(x.a || []).forEach(function(k){ if (k && k.length >= 2 && !map[k]){ map[k] = x; keys.push(k); } }); });
        keys.sort(function(a, b){ return b.length - a.length; });
        terms = { map:map, re:new RegExp(keys.map(esc).join('|')) };
        cb();
      }).catch(function(){ loading = false; });
    }
    function annotate(){
      if (!terms || art.hidden) return;
      var used = {}, count = 0;
      Array.prototype.forEach.call(art.querySelectorAll('.gl-term'), function(b){ used[b.getAttribute('data-gl')] = 1; count++; });
      var w = document.createTreeWalker(art, NodeFilter.SHOW_TEXT, { acceptNode:function(n){
        if (!n.nodeValue || n.nodeValue.length < 2) return NodeFilter.FILTER_REJECT;
        var p = n.parentNode; if (!p || !p.closest) return NodeFilter.FILTER_REJECT;
        if (p.closest('a, button, select, option, input, textarea, script, style, h1, h2, h3, .gl-term, [contenteditable]')) return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT; } });
      var nodes = [], n; while ((n = w.nextNode())) nodes.push(n);
      for (var i = 0; i < nodes.length && count < 14; i++){
        var node = nodes[i], m = terms.re.exec(node.nodeValue); if (!m) continue;
        var x = terms.map[m[0]]; if (!x || used[x.t]) continue;
        used[x.t] = 1; count++;
        var after = node.splitText(m.index); after.nodeValue = after.nodeValue.slice(m[0].length);
        var b = document.createElement('button'); b.type = 'button'; b.className = 'gl-term'; b.setAttribute('data-gl', x.t); b.setAttribute('aria-label', m[0] + ' 용어 설명 보기'); b.textContent = m[0];
        after.parentNode.insertBefore(b, after);
      }
    }
    function run(){ if (mo) mo.disconnect(); safe(annotate); if (mo) mo.observe(art, { childList:true, subtree:true, characterData:true }); }
    function schedule(){ clearTimeout(timer); timer = setTimeout(function(){ load(run); }, 180); }
    mo = new MutationObserver(schedule);
    mo.observe(art, { childList:true, subtree:true, characterData:true, attributes:true, attributeFilter:['hidden'] });
    schedule();
    function hide(){ if (pop) pop.classList.remove('on'); }
    function show(b){
      var x = terms && terms.map[b.getAttribute('data-gl')]; if (!x) return;
      if (!pop){ pop = document.createElement('div'); pop.className = 'gl-pop'; pop.id = 'glPop'; pop.setAttribute('role', 'tooltip'); document.body.appendChild(pop); }
      pop.textContent = '';
      var t = document.createElement('b'); t.textContent = x.t; pop.appendChild(t);
      pop.appendChild(document.createTextNode(x.d));
      var br = document.createElement('div'), a = document.createElement('a'); a.href = 'glossary.html#' + encodeURIComponent(x.t); a.textContent = '용어 사전에서 보기'; br.appendChild(a); pop.appendChild(br);
      pop.style.left = '0px'; pop.style.top = '0px';
      var r = b.getBoundingClientRect(), pw = pop.offsetWidth, ph = pop.offsetHeight;
      var left = Math.max(12, Math.min(window.innerWidth - pw - 12, r.left + r.width / 2 - pw / 2));
      var top = r.bottom + 8; if (top + ph > window.innerHeight - 12) top = Math.max(12, r.top - ph - 8);
      pop.style.left = left + 'px'; pop.style.top = top + 'px'; pop.classList.add('on');
    }
    document.addEventListener('click', function(e){
      var b = e.target.closest && e.target.closest('.gl-term');
      if (b){ e.preventDefault(); show(b); return; }
      if (pop && !pop.contains(e.target)) hide();
    });
    document.addEventListener('keydown', function(e){ if (e.key === 'Escape') hide(); });
    window.addEventListener('scroll', hide, { passive:true });
    window.addEventListener('hashchange', hide);
  });

  /* 6. 서비스 워커 (홈 화면 설치·오프라인 대비) */
  safe(function(){
    if (!('serviceWorker' in navigator) || location.protocol !== 'https:') return;
    window.addEventListener('load', function(){ navigator.serviceWorker.register('sw.js').catch(function(){}); });
  });
})();
