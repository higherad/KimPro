/**
 * STORE.JS — Firebase Realtime Database (kimpro 저장소)
 * 통합 파일 - ha-store.js 대체용
 */

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.10.0/firebase-app.js";
import { getDatabase, ref,
  set as _set, get as _get, push as _push, update as _update, remove as _remove }
  from "https://www.gstatic.com/firebasejs/10.10.0/firebase-database.js";
import { getAuth }
  from "https://www.gstatic.com/firebasejs/10.10.0/firebase-auth.js";

// ── Firebase 초기화 ──────────────────────────────────────────
const firebaseConfig = {
  apiKey: "AIzaSyAF-Rn7tzIjQeyUDJKnvKTRNccsXUVsIjo",
  authDomain: "higherad-b9d62.firebaseapp.com",
  databaseURL: "https://higherad-b9d62-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "higherad-b9d62",
  storageBucket: "higherad-b9d62.firebasestorage.app",
  messagingSenderId: "938928195180",
  appId: "1:938928195180:web:8209b1e02a8caabe643a49",
  measurementId: "G-01T4L4ZGVV"
};

const app  = initializeApp(firebaseConfig);
const db   = getDatabase(app);
const auth = getAuth(app);

// ── 인증 상태 복원 대기 래퍼 ─────────────────────────────────
const authReady = auth.authStateReady();

async function get(r)        { await authReady; return _get(r); }
async function set(r, v)     { await authReady; return _set(r, v); }
async function push(r, v)    { await authReady; return _push(r, v); }
async function update(r, v)  { await authReady; return _update(r, v); }
async function remove(r)     { await authReady; return _remove(r); }

// ── DB 경로 상수 (kimpro) ─────────────────────────────────
const PATHS = {
  slots: 'kimpro/slots',
  users: 'kimpro/users',
};

async function getUserUnitPrice(userId) {
  try {
    const uSnap = await get(ref(db, PATHS.users));
    const u = snapToArray(uSnap).find(u => u.username === (userId || ''));
    return u ? (u.unitPrice || 0) : 0;
  } catch(e) { return 0; }
}

// ── 유틸: Firebase 스냅샷 → 배열 변환 ───────────────────────
function snapToArray(snapshot) {
  if (!snapshot.exists()) return [];
  const val = snapshot.val();
  return Object.entries(val).map(([key, data]) => ({ ...data, _key: key }));
}

// ── 내부 이벤트 버스 ─────────────────────────────────────────
function dispatch(event) {
  window.dispatchEvent(new CustomEvent(event));
}

// ════════════════════════════════════════════════════════════
const HA = {

  // ── 현재 로그인 유저 ───────────────────────────────────────
  getCurrentUser() {
    return JSON.parse(sessionStorage.getItem('ha_current_user') || 'null');
  },

  // ════════════════════════════════════════════════════════
  // 캠페인 CRUD
  // ════════════════════════════════════════════════════════

  async getSlots() {
    const snapshot = await get(ref(db, PATHS.slots));
    return snapToArray(snapshot).sort((a, b) =>
      new Date(b.createdAt) - new Date(a.createdAt)
    );
  },

  async addSlot(data) {
    const unitPriceSnapshot = await getUserUnitPrice(data.userId || '');

    const newSlot = {
      status:        'pending',
      createdAt:     new Date().toISOString(),
      agencyId:      data.agencyId      || '',
      userId:        data.userId        || '',
      startDate:     data.startDate     || '',
      endDate:       data.endDate       || '',
      storeName:     data.storeName     || '',
      rankKeyword:   data.rankKeyword   || '',
      url:           data.url           || '',
      mid:           data.mid           || '',
      memo:          data.memo          || '',
      days:          Number(data.days)        || 0,
      dailyTarget:   Number(data.dailyTarget) || 0,
      searchKeyword: data.searchKeyword  || '',
      unitPrice:     unitPriceSnapshot,
    };
    const newRef = await push(ref(db, PATHS.slots), newSlot);
    const result = { ...newSlot, _key: newRef.key };
    dispatch('ha:slots:updated');
    return result;
  },

  async updateSlot(key, patch) {
    await update(ref(db, `${PATHS.slots}/${key}`), patch);
    dispatch('ha:slots:updated');
  },

  async approveSlot(key) {
    await update(ref(db, `${PATHS.slots}/${key}`), { status: 'active' });
    dispatch('ha:slots:updated');
  },

  async deleteSlot(key) {
    await remove(ref(db, `${PATHS.slots}/${key}`));
    dispatch('ha:slots:updated');
  },

  async getDoc(path) { return get(ref(db, path)); },
  async setDoc(path, val) { return set(ref(db, path), val); },
  async removeDoc(path) { return remove(ref(db, path)); },

  async getChargeAccounts(username) {
    const safeU = username.replace(/[.#$[\]/]/g, '_');
    const snap  = await get(ref(db, `kimpro/charge_accounts/${safeU}`));
    if (!snap.exists()) return {};
    const val = snap.val();
    // 구버전 단일 계정 { id, pw } 자동 변환
    if (val && typeof val.id === 'string') return { _default: { agency: '', id: val.id, pw: val.pw } };
    return val;
  },

  async saveChargeAccount(username, key, data) {
    const safeU = username.replace(/[.#$[\]/]/g, '_');
    const safeK = (key || '_default').replace(/[.#$[\]/]/g, '_');
    await set(ref(db, `kimpro/charge_accounts/${safeU}/${safeK}`), data);
  },

  async deleteChargeAccount(username, key) {
    const safeU = username.replace(/[.#$[\]/]/g, '_');
    const safeK = key.replace(/[.#$[\]/]/g, '_');
    await remove(ref(db, `kimpro/charge_accounts/${safeU}/${safeK}`));
  },

};

// 전역 노출
window.HA = HA;

export default HA;
