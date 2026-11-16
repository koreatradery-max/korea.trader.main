/* STOCK PICK! 보조 페이지 공통 스크립트: 등장 효과, 서비스 워커 등록 */
(function(){
  var reduce = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
  function reveal(root){
    var els = (root || document).querySelectorAll('.rv:not(.in)');
    if (reduce || !('IntersectionObserver' in window)){ els.forEach(function(e){ e.classList.add('in'); }); return; }
    var io = new IntersectionObserver(function(es){ es.forEach(function(e){ if (e.isIntersecting){ e.target.classList.add('in'); io.unobserve(e.target); } }); }, { rootMargin:'0px 0px -5% 0px', threshold:0.05 });
    els.forEach(function(e, i){ e.style.transitionDelay = Math.min(i, 8) * 40 + 'ms'; io.observe(e); });
  }
  window.spReveal = reveal;
  window.spEsc = function(s){ return String(s == null ? '' : s).replace(/[&<>"']/g, function(c){ return ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]; }); };
  window.spChgClass = function(chg){ var s = String(chg || ''); return /^\s*-/.test(s) ? 'dn' : (/^\s*\+?0(\.0+)?\s*(%|bp)?$/.test(s) ? 'flat' : 'up'); };
  window.spChgText = function(chg){ var s = String(chg || '').trim(); if (!s) return ''; if (s.charAt(0) === '-') return '▼ ' + s.slice(1); if (/^\+?0(\.0+)?\s*(%|bp)?$/.test(s)) return s.replace('+',''); return '▲ ' + s.replace('+',''); };
  document.addEventListener('DOMContentLoaded', function(){ reveal(); });
  setTimeout(function(){ document.querySelectorAll('.rv:not(.in)').forEach(function(e){ var r = e.getBoundingClientRect(); if (r.top < window.innerHeight) e.classList.add('in'); }); }, 1200);
  if ('serviceWorker' in navigator && location.protocol === 'https:'){
    window.addEventListener('load', function(){ navigator.serviceWorker.register(document.documentElement.getAttribute('data-root') + 'sw.js').catch(function(){}); });
  }
})();
