/* STOCK PICK! 보조 페이지 계정 동기화 (v38.1)
   홈에서 텔레그램으로 로그인한 상태라면 관심 종목·7일 코스 진도를 prefs/{uid} 에 저장해 기기 간에 맞춘다.
   로그인하지 않았으면 이 기기(localStorage)에만 저장된다. 페이지는 window.spSyncHooks 에 {watch|course:{get,set}} 를 등록한다. */
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.13.1/firebase-app.js";
import { getAuth, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.13.1/firebase-auth.js";
import { getFirestore, doc, getDoc, setDoc } from "https://www.gstatic.com/firebasejs/10.13.1/firebase-firestore.js";
const app = initializeApp({ apiKey: "AIzaSyAsu1RXjvdcxmZK9L5MN902_m9PE9F3rLI", authDomain: "challenge-45dfd.firebaseapp.com", projectId: "challenge-45dfd", storageBucket: "challenge-45dfd.firebasestorage.app", messagingSenderId: "371905793972", appId: "1:371905793972:web:a80188789aa3d612036ce1" });
const auth = getAuth(app), db = getFirestore(app);
const hooks = window.spSyncHooks || {};
const note = document.getElementById('syncNote');
let ref = null;
function say(t){ if (note) note.textContent = t; }
function local(){
  const out = {};
  if (hooks.watch) out.watch = (hooks.watch.get() || []).slice(0, 12);
  if (hooks.course) out.course = { days: hooks.course.get() || [] };
  return out;
}
window.spSyncPush = async function(){
  if (!ref) return;
  try{ await setDoc(ref, { ...local(), at: Date.now() }, { merge: true }); say('계정에 저장됐어요.'); }
  catch(e){ console.warn('[sync]', e); say('계정에 저장하지 못했어요. 이 기기에는 저장돼 있어요.'); }
};
onAuthStateChanged(auth, async (user) => {
  if (!user){ ref = null; say('이 기기에만 저장돼요. 홈에서 로그인하면 계정에 저장돼 다른 기기에서도 볼 수 있어요.'); return; }
  ref = doc(db, 'prefs', user.uid);
  try{
    const s = await getDoc(ref), d = s.exists() ? s.data() : {};
    let push = false;
    if (hooks.watch){ if (Array.isArray(d.watch)) hooks.watch.set(d.watch.slice(0, 12)); else if ((hooks.watch.get() || []).length) push = true; }
    if (hooks.course){ if (d.course && Array.isArray(d.course.days)) hooks.course.set(d.course.days); else if ((hooks.course.get() || []).length) push = true; }
    say('로그인 계정에 저장돼요.');
    if (push) await window.spSyncPush();
  } catch(e){ console.warn('[sync]', e); say('계정 정보를 불러오지 못했어요. 이 기기에는 저장돼 있어요.'); }
});
