/**
 * 고려대 재학생 트레이더 — 텔레그램 로그인 · 메시지 발송 Worker (Cloudflare Workers, 무료 플랜)
 *
 * [환경 변수 / Secrets]  (Cloudflare 대시보드 → Worker → Settings → Variables and Secrets)
 *   BOT_TOKEN        (Secret)  @BotFather 에서 받은 봇 토큰
 *   BOT_USERNAME     (Text)    봇 username (@ 없이) 예: korea_trader_login_bot
 *   WEBHOOK_SECRET   (Secret)  아무 영문/숫자 32자 이상 (텔레그램 웹훅 검증 + /setup 키)
 *   FB_PROJECT_ID    (Text)    Firebase 프로젝트 ID (예: challenge-45dfd)
 *   FB_CLIENT_EMAIL  (Text)    서비스 계정 JSON의 client_email
 *   FB_PRIVATE_KEY   (Secret)  서비스 계정 JSON의 private_key (-----BEGIN PRIVATE KEY----- 포함 전체)
 *   ADMIN_TG_IDS     (Text)    관리자 텔레그램 숫자 ID, 여러 명이면 쉼표로 (예: 123456789)
 *   ALLOWED_ORIGINS  (Text)    사이트 주소, 여러 개면 쉼표로 (예: https://taurusgray45.github.io)
 *   SITE_URL         (Text)    로그인 완료 후 돌아갈 사이트 주소 (예: https://taurusgray45.github.io/)
 *
 * [엔드포인트]
 *   POST /auth/start            로그인 요청 생성 → {token, url, code, expiresAt}
 *   GET  /auth/poll?token=      로그인 상태 확인 → {status, customToken?}
 *   POST /tg/webhook            텔레그램 웹훅 (봇 '시작' 처리)
 *   POST /admin/send            텔레그램 DM 발송 {uids[], text, button?} (관리자)
 *   GET  /setup?key=WEBHOOK_SECRET   웹훅/봇 명령어 등록 (처음 1회)
 *   GET  /market                코스피·코스닥·공포탐욕지수 (2분 캐시)
 *   GET  /stats                 로그인 이용자 수 (10분 캐시)
 *   POST /ch/unlock             100불 챌린지 코드 확인(서버) → 챌린지 전용 토큰 {pid|admin, code}
 *   POST /me/notify             알림 수신 설정 {on} (로그인 회원)
 *   POST /me/delete             회원 탈퇴 · 내 데이터 삭제 (로그인 회원)
 *   POST /briefing/send         아침 시황 발송 {mode:'test'|'all-start'|'all'} (관리자)
 *   GET  /views/teaser          정보 공유 최근 글 미리보기(제목·앞부분·대표 이미지 여부, 2분 캐시)
 *   GET  /views/teaser/{id}     글 1개 미리보기
 *   GET  /views/cover/{id}/{v}  글 대표 이미지 (1일 캐시)
 *   GET  /p/{id}                공유 링크: 링크 미리보기(OG) 후 사이트로 이동
 *   POST /live/import {id}      저장소 live/{id}.json 라이브 요약을 자료실 '라이브 요약'으로 등록 + 핵심 요약을 회원에게 DM(38명씩, 반복 호출)
 *   [Cron] 50-59 23 * * * (UTC) 매일 08:50~08:59 KST 아침 시황 자동 발송 (40명씩 나눠서)
 *   [Cron] 0-9 13 * * 1-5  (UTC) 평일 22:00~22:09 KST 미국장 시황 자동 발송 (briefing/us-latest.json)
 *   BRIEFING_URL     (Text, 선택) 시황 JSON 주소 (기본: SITE_URL + 'briefing/latest.json')
 */

const LOGIN_TTL_MS = 5 * 60 * 1000;      // 로그인 요청 유효시간 5분
const MAX_SEND_PER_CALL = 40;            // 무료 플랜 외부 호출 50개 제한 → 1회 40명
const MAX_CODE_FAILS = 5;                // 챌린지 코드 오입력 허용 횟수
const CODE_LOCK_MS = 10 * 60 * 1000;     // 초과 시 10분 잠금

/* ======================= 진입점 ======================= */
export default {
  async fetch(req, env, ctx) {
    const url = new URL(req.url);
    const cors = corsHeaders(req, env);
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });

    try {
      if (url.pathname === '/auth/start' && req.method === 'POST') return json(await authStart(env), 200, cors);
      if (url.pathname === '/auth/poll' && req.method === 'GET') return json(await authPoll(env, ctx, url.searchParams.get('token')), 200, cors);
      if (url.pathname === '/tg/webhook' && req.method === 'POST') return await tgWebhook(req, env);
      if (url.pathname === '/admin/send' && req.method === 'POST') return await adminSend(req, env, cors);
      if (url.pathname === '/setup' && req.method === 'GET') return json(await setup(env, url), 200, cors);
      if (url.pathname === '/market' && req.method === 'GET') return await cached(req, ctx, 120, async () => json(await marketData(), 200, cors), cors);
      if (url.pathname === '/stats' && req.method === 'GET') return await cached(req, ctx, 600, async () => json(await siteStats(env), 200, cors), cors);
      if (url.pathname === '/ch/unlock' && req.method === 'POST') return await chUnlock(req, env, cors);
      if (url.pathname === '/me/notify' && req.method === 'POST') return await meNotify(req, env, cors);
      if (url.pathname === '/me/delete' && req.method === 'POST') return await meDelete(req, env, cors);
      if (url.pathname === '/briefing/send' && req.method === 'POST') return await briefingSendApi(req, env, cors);
      if (url.pathname === '/live/import' && req.method === 'POST') return await liveImport(req, env, cors);
      if (req.method === 'GET' && url.pathname === '/views/teaser') return await cached(req, ctx, 120, async () => json(await viewsTeaser(env), 200, cors), cors);
      let m;
      if (req.method === 'GET' && (m = url.pathname.match(/^\/views\/teaser\/([A-Za-z0-9_-]{6,40})$/))) return await cached(req, ctx, 120, async () => { const t = await viewTeaser(env, m[1]); return json(t || { error: 'not_found' }, t ? 200 : 404, cors); }, cors);
      if (req.method === 'GET' && (m = url.pathname.match(/^\/views\/cover\/([A-Za-z0-9_-]{6,40})\/[0-9a-z]+(\.jpg)?$/))) return await cached(req, ctx, 86400, async () => await viewCover(env, m[1]), cors);
      if (req.method === 'GET' && (m = url.pathname.match(/^\/p\/([A-Za-z0-9_-]{6,40})$/))) return await cached(req, ctx, 300, async () => await sharePage(env, url, m[1]), {});
      if (url.pathname === '/' ) return json({ ok: true, service: 'telegram-login-worker' }, 200, cors);
      return json({ error: 'not_found' }, 404, cors);
    } catch (err) {
      console.error(err);
      return json({ error: 'server_error', message: String(err && err.message || err) }, 500, cors);
    }
  },
  async scheduled(event, env, ctx) {
    ctx.waitUntil(briefingCron(env).catch(e => console.error('briefing cron', e)));
  }
};

/* ======================= 로그인 ======================= */
async function authStart(env) {
  const token = randomToken(24);                 // 48자 hex
  const code = String(Math.floor(Math.random() * 90) + 10); // 2자리 확인 코드
  const now = Date.now();
  await fsWrite(env, [{ path: `loginSessions/${token}`, data: { status: 'pending', code, createdAt: now, expiresAt: now + LOGIN_TTL_MS } }]);
  return {
    token, code,
    botUsername: env.BOT_USERNAME,
    url: `https://t.me/${env.BOT_USERNAME}?start=${token}`,
    expiresAt: now + LOGIN_TTL_MS
  };
}

async function authPoll(env, ctx, token) {
  if (!token || !/^[a-f0-9]{48}$/.test(token)) return { status: 'invalid' };
  const s = await fsGet(env, `loginSessions/${token}`);
  if (!s) return { status: 'expired' };
  if (Date.now() > s.expiresAt) {
    ctx.waitUntil(fsDelete(env, `loginSessions/${token}`));
    return { status: 'expired' };
  }
  if (s.status !== 'done') return { status: 'pending' };

  const admin = adminIds(env).includes(String(s.tgId));
  const customToken = await createCustomToken(env, s.uid, admin ? { admin: true } : {});
  ctx.waitUntil(fsDelete(env, `loginSessions/${token}`));
  return { status: 'done', customToken, profile: { uid: s.uid, name: s.name, username: s.username || '' }, admin };
}

async function tgWebhook(req, env) {
  if (req.headers.get('X-Telegram-Bot-Api-Secret-Token') !== await hookToken(env)) return new Response('forbidden', { status: 403 });
  const update = await req.json().catch(() => ({}));
  const msg = update.message;
  if (!msg || !msg.text || !msg.from || msg.chat.type !== 'private') return new Response('ok');

  const text = msg.text.trim();
  const from = msg.from;
  const chatId = msg.chat.id;
  const name = [from.first_name, from.last_name].filter(Boolean).join(' ') || from.username || '회원';

  if (text === '/stop' || text === '/alarm') {
    const on = text === '/alarm';
    await fsWrite(env, [{ path: `users/tg_${from.id}`, data: { notify: on }, mask: true }]);
    await tg(env, 'sendMessage', { chat_id: chatId, text: on ? '🔔 공지·새 자료 알림을 다시 받습니다. 끄려면 /stop 을 보내세요.' : '🔕 공지·새 자료 알림을 껐어요. 다시 받으려면 /alarm 을 보내세요.\n(로그인 확인 메시지는 계속 발송돼요)' });
    return new Response('ok');
  }

  if (text === '/id') {
    await tg(env, 'sendMessage', { chat_id: chatId, text: `내 텔레그램 ID: ${from.id}` });
    return new Response('ok');
  }

  if (text.startsWith('/start')) {
    const param = text.split(/\s+/)[1] || '';
    const uid = `tg_${from.id}`;

    if (!/^[a-f0-9]{48}$/.test(param)) {
      // 봇을 그냥 시작한 경우: 알림 수신 허용 처리 + 안내
      await fsWrite(env, [{ path: `users/${uid}`, data: userData(from, chatId), mask: true }]);
      await tg(env, 'sendMessage', {
        chat_id: chatId,
        text: `안녕하세요 ${name}님 👋\n고려대 재학생 트레이더 알림 봇입니다.\n\n사이트에서 '텔레그램으로 로그인'을 누르면 이 봇으로 로그인할 수 있어요.`,
        reply_markup: env.SITE_URL ? { inline_keyboard: [[{ text: '사이트 열기', url: env.SITE_URL }]] } : undefined
      });
      return new Response('ok');
    }

    const s = await fsGet(env, `loginSessions/${param}`);
    if (!s || Date.now() > s.expiresAt) {
      await tg(env, 'sendMessage', { chat_id: chatId, text: '로그인 요청이 만료됐어요. 사이트에서 다시 시도해주세요.' });
      return new Response('ok');
    }
    if (s.status === 'done') {
      await tg(env, 'sendMessage', { chat_id: chatId, text: '이미 로그인된 요청이에요. 사이트로 돌아가주세요.' });
      return new Response('ok');
    }

    await fsWrite(env, [
      { path: `users/${uid}`, data: userData(from, chatId), mask: true },
      { path: `loginSessions/${param}`, data: { status: 'done', uid, tgId: String(from.id), name, username: from.username || '' }, mask: true }
    ]);
    await tg(env, 'sendMessage', {
      chat_id: chatId,
      text: `✅ 로그인 완료!\n확인 코드: ${s.code}\n\n사이트 화면에 보이는 코드와 같다면 정상이에요. 사이트로 돌아가면 자동으로 로그인됩니다.\n공지와 새 자료 알림도 이 봇으로 보내드려요. 받고 싶지 않으면 /stop 을 보내거나 사이트의 '내 정보'에서 끌 수 있어요.`,
      reply_markup: env.SITE_URL ? { inline_keyboard: [[{ text: '사이트로 돌아가기', url: env.SITE_URL }]] } : undefined
    });
    return new Response('ok');
  }

  return new Response('ok');
}

function userData(from, chatId) {
  return {
    tgId: String(from.id),
    chatId: String(chatId),
    firstName: from.first_name || '',
    lastName: from.last_name || '',
    username: from.username || '',
    lastLoginAt: Date.now(),
    canDM: true
  };
}

/* ======================= 챌린지 참여자 연결 ======================= */
async function adminSend(req, env, cors) {
  const auth = await requireUser(req, env);
  if (!auth || !auth.admin) return json({ error: 'forbidden', message: '관리자만 발송할 수 있어요.' }, 403, cors);
  const body = await req.json().catch(() => ({}));
  const uids = Array.isArray(body.uids) ? body.uids.filter(u => /^tg_\d+$/.test(u)).slice(0, MAX_SEND_PER_CALL) : [];
  const text = String(body.text || '').slice(0, 3800);
  if (!uids.length || !text.trim()) return json({ error: 'bad_request', message: '받는 사람과 내용을 확인해주세요.' }, 400, cors);
  const button = body.button && body.button.url && /^https?:\/\//.test(body.button.url)
    ? { inline_keyboard: [[{ text: String(body.button.text || '열기').slice(0, 40), url: body.button.url }]] } : undefined;
  const photo = typeof body.photo === 'string' && /^https:\/\//.test(body.photo) ? body.photo : '';
  const sendOne = async (chatId, personal) => {
    if (photo) {
      const p = await tg(env, 'sendPhoto', { chat_id: chatId, photo, caption: personal.slice(0, 1000), reply_markup: button });
      if (p.ok || p.error_code === 403 || p.error_code === 429) return p;
    }
    return tg(env, 'sendMessage', { chat_id: chatId, text: personal, reply_markup: button, disable_web_page_preview: true });
  };

  const users = await fsBatchGet(env, uids.map(u => `users/${u}`));
  const results = [];
  const blocked = [];
  for (let i = 0; i < uids.length; i++) {
    const u = users[i];
    if (!u || !u.chatId) { results.push({ uid: uids[i], ok: false, error: '로그인 기록 없음' }); continue; }
    if (u.canDM === false) { results.push({ uid: uids[i], ok: false, error: '봇 차단됨' }); continue; }
    if (u.notify === false) { results.push({ uid: uids[i], ok: false, error: '알림 거부' }); continue; }
    const first = u.firstName || u.username || '회원';
    const personal = text.replace(/\{name\}/g, first);
    let r = await sendOne(u.chatId, personal);
    if (!r.ok && r.error_code === 429) {
      const wait = Math.min(((r.parameters && r.parameters.retry_after) || 1) * 1000, 5000);
      await sleep(wait);
      r = await sendOne(u.chatId, personal);
    }
    if (r.ok) results.push({ uid: uids[i], ok: true });
    else {
      const blockedNow = r.error_code === 403;
      if (blockedNow) blocked.push(uids[i]);
      results.push({ uid: uids[i], ok: false, error: blockedNow ? '봇 차단됨' : (r.description || '발송 실패') });
    }
  }
  if (blocked.length) await fsWrite(env, blocked.map(u => ({ path: `users/${u}`, data: { canDM: false }, mask: true })));
  return json({ results }, 200, cors);
}

/* ======================= 100불 챌린지 코드 확인 (서버) =======================
 * 코드는 codes/{pid}, config/admin 문서에만 있고 보안 규칙상 일반 사용자는 읽을 수 없음.
 * 맞으면 챌린지 전용 토큰(uid ch_<pid> / ch_admin)을 발급 → 규칙에서 본인 기록만 수정 가능. */
async function chUnlock(req, env, cors) {
  const body = await req.json().catch(() => ({}));
  const isAdminReq = body.admin === true;
  const pid = isAdminReq ? 'admin' : String(body.pid || '');
  const code = String(body.code || '');
  if (!/^\d{4}$/.test(code) || (!isAdminReq && !/^p\d{2,3}$/.test(pid))) return json({ ok: false, error: 'bad_request', message: '4자리 숫자를 입력하세요.' }, 400, cors);
  const lockPath = `chLocks/${pid}`;
  const [lock, stored] = await fsBatchGet(env, [lockPath, isAdminReq ? 'config/admin' : `codes/${pid}`]);
  const now = Date.now();
  if (lock && lock.until && lock.until > now) {
    return json({ ok: false, error: 'locked', message: `코드를 여러 번 틀려서 잠겼어요. ${Math.ceil((lock.until - now) / 60000)}분 뒤에 다시 시도하세요.` }, 429, cors);
  }
  if (!stored || !stored.code || stored.code !== code) {
    const fails = (lock && lock.until && lock.until <= now ? 0 : (lock && lock.fails) || 0) + 1;
    const data = fails >= MAX_CODE_FAILS ? { fails: 0, until: now + CODE_LOCK_MS } : { fails, until: 0 };
    await fsWrite(env, [{ path: lockPath, data }]);
    return json({ ok: false, error: 'wrong_code', message: fails >= MAX_CODE_FAILS ? '코드를 여러 번 틀려서 10분간 잠겼어요.' : `코드가 올바르지 않습니다. (${MAX_CODE_FAILS - fails}회 남음)` }, 403, cors);
  }
  if (lock && (lock.fails || lock.until)) await fsWrite(env, [{ path: lockPath, data: { fails: 0, until: 0 } }]);
  const customToken = await createCustomToken(env, isAdminReq ? 'ch_admin' : `ch_${pid}`, isAdminReq ? { chAdmin: true } : { pid });
  return json({ ok: true, customToken }, 200, cors);
}

/* ======================= 내 정보: 알림 설정 · 탈퇴 ======================= */
async function meNotify(req, env, cors) {
  const auth = await requireUser(req, env);
  if (!auth || !auth.tg) return json({ error: 'unauthorized' }, 401, cors);
  const body = await req.json().catch(() => ({}));
  const on = body.on !== false;
  await fsWrite(env, [{ path: `users/${auth.uid}`, data: { notify: on, notifyAt: Date.now() }, mask: true }]);
  return json({ ok: true, notify: on }, 200, cors);
}

/* 회원 탈퇴: 회원 정보, 매매일지, 정보 공유 글·댓글·하트·이미지, 신고 기록, 로그인 계정을 삭제 */
async function meDelete(req, env, cors) {
  const auth = await requireUser(req, env);
  if (!auth || !auth.tg) return json({ error: 'unauthorized' }, 401, cors);
  const uid = auth.uid;
  const q = (col, field, val) => fsQuery(env, col, field, val);
  const deletes = new Set();
  const transforms = []; // [{path, field, delta}]
  const add = docs => docs.forEach(d => deletes.add(d.path));

  // 매매일지
  deletes.add(`journals/${uid}`);
  add(await q('jtrades', 'uid', uid));
  add(await q('jphotos', 'uid', uid));
  const myWants = await q('jwants', 'uid', uid);
  myWants.forEach(w => { deletes.add(w.path); if (w.data.target) transforms.push({ path: `journals/${w.data.target}`, field: 'wants', delta: -1 }); });
  add(await q('jwants', 'target', uid));
  // 정보 공유: 내 글과 그 글에 딸린 이미지·댓글·하트
  const myViews = await q('views', 'uid', uid);
  for (const v of myViews) {
    deletes.add(v.path);
    const id = v.path.split('/')[1];
    add(await q('vimgs', 'post', id));
    add(await q('vcomments', 'post', id));
    add(await q('vhearts', 'post', id));
  }
  const myViewIds = new Set(myViews.map(v => v.path.split('/')[1]));
  // 다른 글에 남긴 댓글·하트 (글의 카운트도 함께 줄임)
  (await q('vcomments', 'uid', uid)).forEach(c => { deletes.add(c.path); if (c.data.post && !myViewIds.has(c.data.post)) transforms.push({ path: `views/${c.data.post}`, field: 'comments', delta: -1 }); });
  (await q('vhearts', 'uid', uid)).forEach(h => { deletes.add(h.path); if (h.data.post && !myViewIds.has(h.data.post)) transforms.push({ path: `views/${h.data.post}`, field: 'hearts', delta: -1 }); });
  add(await q('vimgs', 'uid', uid));
  add(await q('reports', 'uid', uid));
  deletes.add(`users/${uid}`);

  // 카운트 조정은 문서가 남아 있을 때만
  const tPaths = [...new Set(transforms.map(t => t.path))].filter(p => !deletes.has(p));
  const exists = tPaths.length ? await fsBatchGet(env, tPaths) : [];
  const alive = new Set(tPaths.filter((p, i) => exists[i]));
  const writes = [...deletes].map(p => ({ delete: fsName(env, p) }));
  transforms.filter(t => alive.has(t.path)).forEach(t => writes.push({
    transform: { document: fsName(env, t.path), fieldTransforms: [{ fieldPath: t.field, increment: { integerValue: String(t.delta) } }] }
  }));
  for (let i = 0; i < writes.length; i += 400) await fsCommit(env, writes.slice(i, i + 400));

  // 로그인 계정(Firebase Authentication) 삭제 — 실패해도 데이터 삭제는 완료
  let authDeleted = false;
  try {
    const r = await fetch(`https://identitytoolkit.googleapis.com/v1/projects/${env.FB_PROJECT_ID}/accounts:delete`, {
      method: 'POST', headers: { Authorization: `Bearer ${await getAccessToken(env)}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ localId: uid })
    });
    authDeleted = r.ok;
  } catch (e) {}
  return json({ ok: true, deleted: deletes.size, authDeleted }, 200, cors);
}




/* ======================= 라이브 요약 등록 =======================
 * 운영자가 방송 후 대본(텍스트)을 Claude에게 주면 Claude가 요약해 저장소 live/{id}.json 으로 올리고 이 주소를 부름. */
/* 저장소에 올라온 요약(live/{id}.json)을 자료실 글로 등록. 누구나 부를 수 있지만 우리 저장소 파일만 읽고, 같은 글은 한 번만 만듦 */
async function liveImport(req, env, cors) {
  const body = await req.json().catch(() => ({}));
  const id = String(body.id || '');
  if (!/^[A-Za-z0-9_-]{6,40}$/.test(id)) return json({ error: 'bad_request' }, 400, cors);
  const site = String(env.SITE_URL || 'https://koreatradery-max.github.io/korea.trader.main/').replace(/#.*$/, '').replace(/\/?$/, '/');
  const pid = `live_${id}`;
  let post = await fsGet(env, `posts/${pid}`);
  if (!post) {
    const r = await fetch(`${site}live/${id}.json?t=${Date.now()}`, { headers: { 'Cache-Control': 'no-cache' } });
    if (!r.ok) return json({ error: 'summary_not_found', message: '저장소에 요약 파일이 아직 없어요.' }, 404, cors);
    const s = await r.json().catch(() => null);
    if (!s || s.id !== id || !s.title || !s.content || !s.oneLine) return json({ error: 'bad_summary' }, 400, cors);
    const vurl = /^https:\/\/(www\.)?(youtube\.com|youtu\.be)\//.test(String(s.videoUrl || '')) ? String(s.videoUrl) : null;
    const cut = (x, n) => String(x || '').slice(0, n);
    post = {
      title: cut(s.title, 120), content: cut(s.content, 6000), category: 'live', tags: (Array.isArray(s.tags) ? s.tags : []).slice(0, 12).map(t => cut(t, 30)),
      createdAt: Date.parse(s.liveEnd || '') || Date.now(), views: 0,
      pdfId: null, pdfName: null, pdfChunks: 0, pdfThumb: null, pdfPages: 0, pdfSizeMB: 0, searchText: cut(s.content, 6000), images: [],
      liveType: 'live', duration: cut(s.duration, 20) || null, videoUrl: vurl, oneLine: cut(s.oneLine, 200), chaptersRaw: cut(s.chaptersRaw, 2000) || null,
      keyPoints: (Array.isArray(s.keyPoints) ? s.keyPoints : []).slice(0, 6).map(k => cut(k, 160)),
      asOf: cut(s.asOf, 10) || null, source: '라이브 방송 내용을 AI가 요약', holding: null, auto: true
    };
    await fsWrite(env, [{ path: `posts/${pid}`, data: post }]);
  }
  if (body.notify === false) return json({ ok: true, id: pid, sent: 0, done: true }, 200, cors);
  const base = site;
  const keys = (post.keyPoints || []).filter(Boolean);
  const text = [`🎥 라이브 요약 · ${post.title}`, '', post.oneLine ? `“${post.oneLine}”` : '', ...(keys.length ? ['', '▍핵심 정리', ...keys.map(k => `• ${k}`)] : []), '', '※ 정보 제공 목적이며 매수·매도 추천이 아닙니다.'].filter((l, i, a) => !(l === '' && a[i - 1] === '')).join('\n').slice(0, 3800);
  const rows = [[{ text: '전체 요약 보기', url: `${base}#post=${pid}` }]];
  if (post.videoUrl) rows.push([{ text: '▶ 다시보기', url: post.videoUrl }]);
  const markup = { inline_keyboard: rows };
  const r2 = await dmBatch(env, `liveRuns/${id}`, text, markup, false, '');
  return json({ ok: true, id: pid, ...r2 }, 200, cors);
}

/* ======================= 정보 공유: 공개 미리보기 · 공유 링크 =======================
 * 글 본문은 로그인 회원만 보지만, 제목·앞부분(약 160자)·대표 이미지는 공개 (운영자 결정, 2026-11-02). */
const TEASER_LEN = 160;
function teaserOf(id, d) {
  const text = String(d.body || '').replace(/\s+/g, ' ').trim();
  const cover = Number(d.imgCount || 0) > 0;
  return {
    id, title: String(d.title || ''), category: d.category || 'etc', createdAt: d.createdAt || 0,
    excerpt: text.slice(0, TEASER_LEN) + (text.length > TEASER_LEN ? '…' : ''),
    cover, v: String(d.updatedAt || d.createdAt || 0), hearts: Number(d.hearts || 0)
  };
}
async function viewsTeaser(env) {
  const res = await fetch(`${fsBase(env)}:runQuery`, {
    method: 'POST', headers: { Authorization: `Bearer ${await getAccessToken(env)}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ structuredQuery: { from: [{ collectionId: 'views' }], orderBy: [{ field: { fieldPath: 'createdAt' }, direction: 'DESCENDING' }], limit: 8 } })
  });
  if (!res.ok) throw new Error(`Firestore 조회 실패 ${res.status}`);
  const prefix = fsName(env, 'views/');
  return { posts: (await res.json()).filter(r => r.document).map(r => teaserOf(r.document.name.slice(prefix.length), fromFields(r.document.fields || {}))) };
}
async function viewTeaser(env, id) {
  const d = await fsGet(env, `views/${id}`);
  return d ? teaserOf(id, d) : null;
}
async function viewCover(env, id) {
  const d = await fsGet(env, `views/${id}`);
  const idx = d ? Number(d.cover || 0) : 0;
  const img = d && Number(d.imgCount || 0) > 0 ? await fsGet(env, `vimgs/${id}_${idx}`) : null;
  const m = img && String(img.data || '').match(/^data:(image\/(?:jpeg|png|webp));base64,(.+)$/);
  if (!m) return new Response('not found', { status: 404 });
  const bin = Uint8Array.from(atob(m[2]), c => c.charCodeAt(0));
  return new Response(bin, { status: 200, headers: { 'Content-Type': m[1], 'Cache-Control': 'public, max-age=86400' } });
}
const escAttr = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
async function sharePage(env, url, id) {
  const site = String(env.SITE_URL || 'https://koreatradery-max.github.io/korea.trader.main/').replace(/#.*$/, '');
  const target = `${site}#views/${id}`;
  const t = await viewTeaser(env, id);
  const title = t ? `${t.title} | STOCK PICK!` : 'STOCK PICK! 정보 공유';
  const desc = t ? (t.excerpt || '정보 공유 게시판') : '정보 공유 게시판';
  const img = t && t.cover ? `${url.origin}/views/cover/${id}/${t.v}.jpg` : '';
  const html = `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escAttr(title)}</title>
<meta property="og:type" content="article"><meta property="og:site_name" content="STOCK PICK!">
<meta property="og:title" content="${escAttr(title)}"><meta property="og:description" content="${escAttr(desc)}">
<meta property="og:url" content="${escAttr(url.origin + '/p/' + id)}">
${img ? `<meta property="og:image" content="${escAttr(img)}"><meta name="twitter:card" content="summary_large_image"><meta name="twitter:image" content="${escAttr(img)}">` : '<meta name="twitter:card" content="summary">'}
<meta http-equiv="refresh" content="0;url=${escAttr(target)}">
<style>body{background:#0C131D;color:#E6EBF2;font-family:sans-serif;display:grid;place-items:center;min-height:100vh;margin:0}a{color:#C8961E}</style>
</head><body><p><a href="${escAttr(target)}">STOCK PICK!에서 글 보기 ›</a></p><script>location.replace(${JSON.stringify(target)})</script></body></html>`;
  return new Response(html, { status: t ? 200 : 404, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
}

/* ======================= 아침 시황 발송 =======================
 * 시황 JSON(GitHub Pages)을 읽어 로그인 회원(알림 켠 사람)에게 텔레그램 DM.
 * 무료 플랜은 요청당 외부 호출 50개 제한 → 40명씩 나눠 보내고 진행 상황은 briefingRuns/{날짜}에 저장. */
const BRIEF_BATCH = 38;
function kstToday() { return new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10); }
const BRIEF_KINDS = {
  morning: { file: 'latest.json', title: '아침 시황', icon: '📊', h: ['밤사이 미국 증시', '환율 · 금리 · 원자재', '밤사이 체크할 뉴스', '오늘의 일정'], hash: '#briefing', run: '' },
  us: { file: 'us-latest.json', title: '미국장 시황', icon: '🇺🇸', h: ['미국 지수 선물 (개장 전)', '환율 · 금리 · 원자재', '오늘 밤 체크할 뉴스', '오늘 밤 일정 (한국 시간)'], hash: '#briefing/us', run: 'us-' }
};
function briefingUrl(env, kind) {
  const base = String(env.SITE_URL || 'https://koreatradery-max.github.io/korea.trader.main/').replace(/#.*$/, '').replace(/\/?$/, '/');
  return base + 'briefing/' + BRIEF_KINDS[kind || 'morning'].file;
}
async function loadBriefing(env, kind) {
  const r = await fetch(briefingUrl(env, kind) + '?t=' + Date.now(), { headers: { 'Cache-Control': 'no-cache' } });
  if (!r.ok) return null;
  const b = await r.json().catch(() => null);
  if (b && b.date) b.kind = kind || 'morning';
  return b && b.date ? b : null;
}
const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
function arrowChg(c) {
  const s = String(c || '').trim(); if (!s) return '';
  if (/^[+▲]/.test(s)) return '▲' + s.replace(/^[+▲]/, '');
  if (/^[-−▼]/.test(s)) return '▼' + s.replace(/^[-−▼]/, '');
  return s;
}
function briefingText(b) {
  const m = String(b.date).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const dl = m ? `${+m[2]}월 ${+m[3]}일${b.weekday ? '(' + b.weekday + ')' : ''}` : b.date;
  const K = BRIEF_KINDS[b.kind || 'morning'];
  const L = [];
  L.push(`${K.icon} <b>STOCK PICK! ${K.title} · ${esc(dl)}</b>`);
  if ((b.us || []).length) {
    L.push('', `▍<b>${K.h[0]}</b>`);
    b.us.forEach(x => L.push(`${esc(x.name)}  <b>${esc(x.value)}</b>  ${esc(arrowChg(x.chg))}`));
  }
  if ((b.macro || []).length) {
    L.push('', `▍<b>${K.h[1]}</b>`);
    const parts = b.macro.map(x => `${esc(x.name)} ${esc(x.value)}${x.chg ? ' ' + esc(arrowChg(x.chg)) : ''}`);
    for (let i = 0; i < parts.length; i += 2) L.push(parts.slice(i, i + 2).join(' · '));
  }
  if ((b.news || []).length) {
    L.push('', `▍<b>${K.h[2]}</b>`);
    b.news.slice(0, 5).forEach((n, i) => {
      const u = /^https?:\/\//.test(n.url || '') ? n.url : '';
      L.push(`${i + 1}. <b>${esc(n.title)}</b>`);
      L.push(`   → ${esc(n.summary)}${n.source ? ' (' + (u ? `<a href="${esc(u)}">${esc(n.source)}</a>` : esc(n.source)) + ')' : ''}`);
    });
  }
  if ((b.schedule || []).length) {
    L.push('', `▍<b>${K.h[3]}</b>`);
    b.schedule.forEach(c => L.push(`${esc(c.time)} ${esc(c.text)}`));
  }
  if (b.headline) L.push('', `💬 <b>한 줄 정리:</b> ${esc(b.headline)}`);
  L.push('', '<i>※ 정보 제공 목적이며 매수·매도 추천이 아닙니다. AI가 공개 자료를 바탕으로 작성했습니다.</i>');
  let t = L.join('\n');
  if (t.length > 4000) t = t.slice(0, 3990) + '…';
  return t;
}
function briefingMarkup(env, kind) {
  const base = String(env.SITE_URL || 'https://koreatradery-max.github.io/korea.trader.main/').replace(/#.*$/, '');
  return { inline_keyboard: [[{ text: '전체 시황 보기', url: base + BRIEF_KINDS[kind || 'morning'].hash }]] };
}
async function sendBriefingTo(env, chatId, text, markup, parseMode) {
  const pm = parseMode === undefined ? 'HTML' : parseMode;
  const payload = { chat_id: chatId, text, reply_markup: markup, disable_web_page_preview: true };
  if (pm) payload.parse_mode = pm;
  let r = await tg(env, 'sendMessage', payload);
  if (!r.ok && r.error_code === 429) {
    await sleep(Math.min(((r.parameters && r.parameters.retry_after) || 1) * 1000, 4000));
    r = await tg(env, 'sendMessage', payload);
  }
  return r;
}
/* users 컬렉션을 문서 이름 순으로 cursor 다음부터 limit개 */
async function fsUsersPage(env, after, limit) {
  const q = { from: [{ collectionId: 'users' }], orderBy: [{ field: { fieldPath: '__name__' }, direction: 'ASCENDING' }], limit };
  if (after) q.startAt = { values: [{ referenceValue: fsName(env, `users/${after}`) }], before: false };
  const res = await fetch(`${fsBase(env)}:runQuery`, {
    method: 'POST', headers: { Authorization: `Bearer ${await getAccessToken(env)}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ structuredQuery: q })
  });
  if (!res.ok) throw new Error(`Firestore 조회 실패 ${res.status}: ${await res.text()}`);
  const prefix = fsName(env, 'users/');
  return (await res.json()).filter(r => r.document).map(r => ({ id: r.document.name.slice(prefix.length), data: fromFields(r.document.fields || {}) }));
}
/* 한 묶음 발송. state: briefingRuns/{date} {cursor, done, sent} */
async function briefingBatch(env, b, restart) {
  const statePath = `briefingRuns/${BRIEF_KINDS[b.kind || 'morning'].run}${b.date}`;
  const r = await dmBatch(env, statePath, briefingText(b), briefingMarkup(env, b.kind), restart, 'HTML');
  return { ...r, date: b.date };
}
/* 알림 켠 로그인 회원에게 38명씩 나눠 DM. 진행 상황은 statePath 문서에 저장 (다시 부르면 이어서) */
async function dmBatch(env, statePath, text, markup, restart, parseMode) {
  let st = restart ? null : await fsGet(env, statePath);
  if (st && st.done) return { sent: 0, done: true };
  const users = await fsUsersPage(env, st && st.cursor, BRIEF_BATCH);
  let sent = 0; const blocked = [];
  for (const u of users) {
    const d = u.data;
    if (!d.chatId || d.canDM === false || d.notify === false) continue;
    const r = await sendBriefingTo(env, d.chatId, text, markup, parseMode);
    if (r.ok) sent++; else if (r.error_code === 403) blocked.push(u.id);
  }
  const done = users.length < BRIEF_BATCH;
  const writes = [{ path: statePath, data: { cursor: users.length ? users[users.length - 1].id : (st && st.cursor) || '', done, sent: ((st && st.sent) || 0) + sent, at: Date.now() } }];
  blocked.forEach(id => writes.push({ path: `users/${id}`, data: { canDM: false }, mask: true }));
  await fsWrite(env, writes);
  return { sent, done };
}
async function briefingCron(env) {
  const now = new Date();
  const kind = now.getUTCHours() === 13 ? 'us' : 'morning';   // 13시 UTC = 22시 KST
  const K = BRIEF_KINDS[kind];
  const b = await loadBriefing(env, kind);
  const today = kstToday();
  const minute = now.getUTCMinutes();
  if (!b || b.date !== today) {
    // 마지막 분(x9분)까지도 오늘 시황이 없으면 관리자에게만 알림 (1회)
    if (minute % 10 === 9) {
      const path = `briefingRuns/${K.run}${today}`;
      const st = await fsGet(env, path);
      if (!st || !st.alerted) {
        for (const id of adminIds(env)) await tg(env, 'sendMessage', { chat_id: id, text: `⚠️ ${today} ${K.title} 파일이 아직 없어서 자동 발송을 건너뛰었어요.` });
        await fsWrite(env, [{ path, data: { alerted: true, done: true, at: Date.now() }, mask: true }]);
      }
    }
    return;
  }
  await briefingBatch(env, b, false);
}
async function briefingSendApi(req, env, cors) {
  const auth = await requireUser(req, env);
  if (!auth || !auth.admin) return json({ error: 'forbidden', message: '관리자만 발송할 수 있어요.' }, 403, cors);
  const body = await req.json().catch(() => ({}));
  const kind = body.kind === 'us' ? 'us' : 'morning';
  const b = await loadBriefing(env, kind);
  if (!b) return json({ error: 'no_briefing', message: '발행된 시황 파일이 없어요.' }, 404, cors);
  if (body.mode === 'test') {
    const text = briefingText(b), markup = briefingMarkup(env, kind);
    const me = /^tg_(\d+)$/.exec(auth.uid);
    const ids = me ? [me[1]] : adminIds(env);
    let sent = 0; const errors = [];
    for (const id of ids) { const r = await sendBriefingTo(env, id, text, markup); if (r.ok) sent++; else errors.push(r.description || 'fail'); }
    return json({ ok: sent > 0, sent, date: b.date, errors }, 200, cors);
  }
  const r = await briefingBatch(env, b, body.mode === 'all-start');
  return json({ ok: true, ...r }, 200, cors);
}

/* ======================= 최초 설정 ======================= */
async function setup(env, url) {
  if (url.searchParams.get('key') !== env.WEBHOOK_SECRET) return { error: 'forbidden' };
  const hook = `${url.origin}/tg/webhook`;
  const me = await tg(env, 'getMe', {});
  const webhook = await tg(env, 'setWebhook', { url: hook, secret_token: await hookToken(env), allowed_updates: ['message'], drop_pending_updates: true });
  const commands = await tg(env, 'setMyCommands', { commands: [{ command: 'start', description: '시작 / 로그인' }, { command: 'stop', description: '공지·자료 알림 끄기' }, { command: 'alarm', description: '공지·자료 알림 켜기' }, { command: 'id', description: '내 텔레그램 ID 확인' }] });
  let firestore = 'ok';
  try { await fsGet(env, 'loginSessions/setup-check'); } catch (e) { firestore = 'error: ' + e.message; }
  return { bot: me.ok ? `@${me.result.username}` : me, botUsernameMatches: me.ok ? me.result.username === env.BOT_USERNAME : false, webhook, commands, firestore };
}

/* ======================= 시장 지표 · 통계 ======================= */
async function cached(req, ctx, ttl, make, cors) {
  const cache = typeof caches !== 'undefined' && caches.default ? caches.default : null;
  const key = new Request(new URL(req.url).origin + new URL(req.url).pathname, { method: 'GET' });
  let res = cache ? await cache.match(key) : null;
  if (!res) {
    res = await make();
    if (res.status === 200 && cache) {
      const store = new Response(res.clone().body, res);
      store.headers.set('Cache-Control', `public, max-age=${ttl}`);
      ctx.waitUntil(cache.put(key, store));
    }
  }
  const out = new Response(res.body, res);
  Object.entries(cors).forEach(([k, v]) => out.headers.set(k, v));
  return out;
}
const UA = { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36', 'Accept': 'application/json' };
async function naverIndex(code) {
  try {
    const r = await fetch(`https://m.stock.naver.com/api/index/${code}/basic`, { headers: UA });
    if (!r.ok) return null;
    const d = await r.json();
    const sign = d.compareToPreviousPrice && d.compareToPreviousPrice.code === '5' ? '-' : '';
    const chg = String(d.compareToPreviousClosePrice || '0');
    return {
      price: d.closePrice, change: chg.startsWith('-') || chg.startsWith('+') ? chg : sign + chg,
      pct: Number(d.fluctuationsRatio || 0), status: d.marketStatus === 'OPEN' ? '장중' : d.marketStatus === 'CLOSE' ? '장 마감' : '', at: d.localTradedAt || ''
    };
  } catch (e) { return null; }
}
async function fearGreed() {
  try {
    const r = await fetch('https://production.dataviz.cnn.io/index/fearandgreed/graphdata', { headers: { ...UA, 'Referer': 'https://edition.cnn.com/', 'Origin': 'https://edition.cnn.com' } });
    if (!r.ok) return null;
    const d = await r.json(); const f = d.fear_and_greed || {};
    return { score: f.score, rating: f.rating, prev: f.previous_close, at: f.timestamp };
  } catch (e) { return null; }
}
async function marketData() {
  const [kospi, kosdaq, fg] = await Promise.all([naverIndex('KOSPI'), naverIndex('KOSDAQ'), fearGreed()]);
  return { kospi, kosdaq, fearGreed: fg, at: Date.now() };
}
async function siteStats(env) {
  try {
    const res = await fetch(`${fsBase(env)}:runAggregationQuery`, {
      method: 'POST', headers: { Authorization: `Bearer ${await getAccessToken(env)}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ structuredAggregationQuery: { structuredQuery: { from: [{ collectionId: 'users' }] }, aggregations: [{ alias: 'n', count: {} }] } })
    });
    const arr = await res.json();
    const v = arr && arr[0] && arr[0].result && arr[0].result.aggregateFields && arr[0].result.aggregateFields.n;
    return { users: v ? Number(v.integerValue) : null };
  } catch (e) { return { users: null }; }
}

/* ======================= 텔레그램 ======================= */
/* 텔레그램 웹훅 secret_token은 영문·숫자·_- 만 허용 → WEBHOOK_SECRET을 SHA-256 hex로 변환해 사용 */
async function hookToken(env) {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(String(env.WEBHOOK_SECRET || '')));
  return [...new Uint8Array(d)].map(b => b.toString(16).padStart(2, '0')).join('');
}

async function tg(env, method, payload) {
  const res = await fetch(`https://api.telegram.org/bot${env.BOT_TOKEN}/${method}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload)
  });
  return res.json().catch(() => ({ ok: false, description: 'bad response' }));
}

/* ======================= Firebase 인증 ======================= */
let accessTokenCache = { token: null, exp: 0 };
let jwkCache = { keys: null, exp: 0 };
let signKeyCache = null;

async function getSignKey(env) {
  if (signKeyCache) return signKeyCache;
  // 붙여넣을 때 따옴표·쉼표·\n 등이 섞여도 동작하도록 BEGIN~END 사이의 base64만 추출
  const raw = String(env.FB_PRIVATE_KEY || '');
  const m = raw.match(/-----BEGIN PRIVATE KEY-----([\s\S]*?)-----END PRIVATE KEY-----/);
  const b64 = (m ? m[1] : raw).replace(/\\+n/g, '').replace(/[^A-Za-z0-9+/=]/g, '');
  const der = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
  signKeyCache = await crypto.subtle.importKey('pkcs8', der, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
  return signKeyCache;
}

async function signJwt(env, payload) {
  const header = { alg: 'RS256', typ: 'JWT' };
  const enc = obj => b64url(new TextEncoder().encode(JSON.stringify(obj)));
  const data = `${enc(header)}.${enc(payload)}`;
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', await getSignKey(env), new TextEncoder().encode(data));
  return `${data}.${b64url(new Uint8Array(sig))}`;
}

async function getAccessToken(env) {
  const now = Math.floor(Date.now() / 1000);
  if (accessTokenCache.token && accessTokenCache.exp - 60 > now) return accessTokenCache.token;
  const assertion = await signJwt(env, {
    iss: env.FB_CLIENT_EMAIL, scope: 'https://www.googleapis.com/auth/datastore https://www.googleapis.com/auth/identitytoolkit',
    aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600
  });
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `grant_type=${encodeURIComponent('urn:ietf:params:oauth:grant-type:jwt-bearer')}&assertion=${assertion}`
  });
  const data = await res.json();
  if (!data.access_token) throw new Error('Google 인증 실패: ' + JSON.stringify(data));
  accessTokenCache = { token: data.access_token, exp: now + (data.expires_in || 3600) };
  return data.access_token;
}

async function createCustomToken(env, uid, claims) {
  const now = Math.floor(Date.now() / 1000);
  return signJwt(env, {
    iss: env.FB_CLIENT_EMAIL, sub: env.FB_CLIENT_EMAIL,
    aud: 'https://identitytoolkit.googleapis.com/google.identity.identitytoolkit.v1.IdentityToolkit',
    iat: now, exp: now + 3600, uid, claims
  });
}

/* 사이트에서 보낸 Firebase ID 토큰 검증 */
async function requireUser(req, env) {
  const h = req.headers.get('Authorization') || '';
  const m = h.match(/^Bearer (.+)$/);
  if (!m) return null;
  const parts = m[1].split('.');
  if (parts.length !== 3) return null;
  const header = JSON.parse(new TextDecoder().decode(b64urlDecode(parts[0])));
  const payload = JSON.parse(new TextDecoder().decode(b64urlDecode(parts[1])));
  const now = Math.floor(Date.now() / 1000);
  if (payload.aud !== env.FB_PROJECT_ID) return null;
  if (payload.iss !== `https://securetoken.google.com/${env.FB_PROJECT_ID}`) return null;
  if (!payload.sub || payload.exp < now || payload.iat > now + 300) return null;

  if (!jwkCache.keys || jwkCache.exp < Date.now()) {
    const res = await fetch('https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com');
    const data = await res.json();
    jwkCache = { keys: data.keys || [], exp: Date.now() + 3600 * 1000 };
  }
  const jwk = jwkCache.keys.find(k => k.kid === header.kid);
  if (!jwk) return null;
  const key = await crypto.subtle.importKey('jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
  const ok = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, b64urlDecode(parts[2]), new TextEncoder().encode(`${parts[0]}.${parts[1]}`));
  if (!ok) return null;
  return { uid: payload.sub, admin: payload.admin === true, tg: /^tg_\d+$/.test(payload.sub) };
}

/* ======================= Firestore REST ======================= */
function fsBase(env) { return `https://firestore.googleapis.com/v1/projects/${env.FB_PROJECT_ID}/databases/(default)/documents`; }
function fsName(env, path) { return `projects/${env.FB_PROJECT_ID}/databases/(default)/documents/${path}`; }

async function fsGet(env, path) {
  const res = await fetch(`${fsBase(env)}/${path}`, { headers: { Authorization: `Bearer ${await getAccessToken(env)}` } });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Firestore 읽기 실패 ${res.status}: ${await res.text()}`);
  return fromFields((await res.json()).fields || {});
}

async function fsBatchGet(env, paths) {
  const res = await fetch(`${fsBase(env)}:batchGet`, {
    method: 'POST', headers: { Authorization: `Bearer ${await getAccessToken(env)}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ documents: paths.map(p => fsName(env, p)) })
  });
  if (!res.ok) throw new Error(`Firestore 읽기 실패 ${res.status}: ${await res.text()}`);
  const arr = await res.json();
  const byName = {};
  arr.forEach(r => { if (r.found) byName[r.found.name] = fromFields(r.found.fields || {}); });
  return paths.map(p => byName[fsName(env, p)] || null);
}

/* writes: [{path, data, mask?}] — mask:true 이면 data에 있는 필드만 갱신(merge) */
async function fsWrite(env, writes) {
  const body = {
    writes: writes.map(w => {
      const out = { update: { name: fsName(env, w.path), fields: toFields(w.data) } };
      if (w.mask) out.updateMask = { fieldPaths: Object.keys(w.data) };
      return out;
    })
  };
  const res = await fetch(`${fsBase(env)}:commit`, {
    method: 'POST', headers: { Authorization: `Bearer ${await getAccessToken(env)}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  if (!res.ok) throw new Error(`Firestore 쓰기 실패 ${res.status}: ${await res.text()}`);
}

async function fsCommit(env, writes) {
  const res = await fetch(`${fsBase(env)}:commit`, {
    method: 'POST', headers: { Authorization: `Bearer ${await getAccessToken(env)}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ writes })
  });
  if (!res.ok) throw new Error(`Firestore 쓰기 실패 ${res.status}: ${await res.text()}`);
}

/* 단일 필드 일치 조회 → [{path, data}] */
async function fsQuery(env, collectionId, field, value) {
  const res = await fetch(`${fsBase(env)}:runQuery`, {
    method: 'POST', headers: { Authorization: `Bearer ${await getAccessToken(env)}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ structuredQuery: { from: [{ collectionId }], where: { fieldFilter: { field: { fieldPath: field }, op: 'EQUAL', value: toValue(value) } }, limit: 1000 } })
  });
  if (!res.ok) throw new Error(`Firestore 조회 실패 ${res.status}: ${await res.text()}`);
  const arr = await res.json();
  const prefix = fsName(env, '');
  return arr.filter(r => r.document).map(r => ({ path: r.document.name.slice(prefix.length), data: fromFields(r.document.fields || {}) }));
}

async function fsDelete(env, path) {
  await fetch(`${fsBase(env)}/${path}`, { method: 'DELETE', headers: { Authorization: `Bearer ${await getAccessToken(env)}` } });
}

function toValue(v) {
  if (v === null || v === undefined) return { nullValue: null };
  if (typeof v === 'boolean') return { booleanValue: v };
  if (typeof v === 'number') return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
  if (typeof v === 'string') return { stringValue: v };
  if (Array.isArray(v)) return { arrayValue: { values: v.map(toValue) } };
  if (typeof v === 'object') return { mapValue: { fields: toFields(v) } };
  return { stringValue: String(v) };
}
function toFields(obj) { const f = {}; for (const k of Object.keys(obj)) f[k] = toValue(obj[k]); return f; }
function fromValue(v) {
  if ('stringValue' in v) return v.stringValue;
  if ('integerValue' in v) return Number(v.integerValue);
  if ('doubleValue' in v) return v.doubleValue;
  if ('booleanValue' in v) return v.booleanValue;
  if ('nullValue' in v) return null;
  if ('timestampValue' in v) return Date.parse(v.timestampValue);
  if ('arrayValue' in v) return (v.arrayValue.values || []).map(fromValue);
  if ('mapValue' in v) return fromFields(v.mapValue.fields || {});
  return null;
}
function fromFields(f) { const o = {}; for (const k of Object.keys(f)) o[k] = fromValue(f[k]); return o; }

/* ======================= 유틸 ======================= */
function adminIds(env) { return String(env.ADMIN_TG_IDS || '').split(',').map(s => s.trim()).filter(Boolean); }
function randomToken(bytes) { const a = new Uint8Array(bytes); crypto.getRandomValues(a); return [...a].map(b => b.toString(16).padStart(2, '0')).join(''); }
function b64url(bytes) { let s = ''; bytes.forEach(b => { s += String.fromCharCode(b); }); return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); }
function b64urlDecode(str) { const s = str.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((str.length + 3) % 4); return Uint8Array.from(atob(s), c => c.charCodeAt(0)); }
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
function corsHeaders(req, env) {
  const origin = req.headers.get('Origin') || '';
  const allowed = String(env.ALLOWED_ORIGINS || '*').split(',').map(s => s.trim().replace(/\/$/, ''));
  const ok = allowed.includes('*') || allowed.includes(origin);
  return {
    'Access-Control-Allow-Origin': ok ? (origin || '*') : allowed[0] || '',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Max-Age': '86400',
    'Vary': 'Origin'
  };
}
function json(obj, status, headers) {
  return new Response(JSON.stringify(obj), { status: status || 200, headers: { 'Content-Type': 'application/json; charset=utf-8', ...(headers || {}) } });
}
