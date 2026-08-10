/**
 * STORE.JS — Firebase Realtime Database (kimpro 저장소)
 * 통합 파일 - ha-store.js 대체용
 */

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.10.0/firebase-app.js";
import { getDatabase, ref, query, orderByChild, orderByKey, equalTo, startAfter,
  set as _set, get as _get, push as _push, update as _update, remove as _remove,
  onValue, onChildAdded, onChildChanged, onChildRemoved }
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
      new Date(b.createdAt || 0) - new Date(a.createdAt || 0)
    );
  },

  // 특정 MID의 슬롯만 인덱스 쿼리로 조회 (전체 슬롯을 매번 통째로 내려받는 것을 피하기 위함 —
  // kimpro/slots에는 .indexOn: "mid"가 걸려있어 서버에서 필터링되어 매칭분만 전송됨)
  async getSlotsByMid(mid) {
    const snapshot = await get(query(ref(db, PATHS.slots), orderByChild('mid'), equalTo(mid)));
    return snapToArray(snapshot);
  },

  // 목록 실시간 반영용 — getSlots()로 이미 받은 뒤 "이후 변경분"만 구독 (child 단위 이벤트라
  // 상태 하나 바뀔 때마다 목록 전체(수천 건, 수 MB)가 재전송되는 걸 피함).
  // currentSlots: getSlots() 결과 배열(호출부가 이미 들고 있는 것을 그대로 넘기면 됨) — 그중
  // 가장 큰 push key(=가장 최근 생성) 이후에 생긴 것만 "추가"로 취급해, 기존 데이터가
  // child_added로 다시 통째로 리플레이되는 것도 피한다. (호출부마다 afterKey를 직접 계산하지
  // 않도록 이 함수 안에서 구함)
  async subscribeSlots(currentSlots, { onAdded, onChanged, onRemoved } = {}) {
    await authReady;
    const afterKey = (currentSlots || []).reduce((m, s) => (s._key && (!m || s._key > m)) ? s._key : m, null);
    const base = ref(db, PATHS.slots);
    const addedRef = afterKey ? query(base, orderByKey(), startAfter(afterKey)) : base;
    const offAdded   = onChildAdded(addedRef, snap => onAdded   && onAdded({ ...snap.val(), _key: snap.key }));
    const offChanged = onChildChanged(base,   snap => onChanged && onChanged({ ...snap.val(), _key: snap.key }));
    const offRemoved = onChildRemoved(base,   snap => onRemoved && onRemoved(snap.key));
    return () => { offAdded(); offChanged(); offRemoved(); };
  },

  // 대량 등록 루프처럼 같은 userId로 addSlot을 여러 번 호출할 때, 매번 users 전체를
  // 재조회하지 않도록 호출부에서 1회 조회해 각 addSlot({unitPrice: ...})에 넘기는 용도.
  async getUserUnitPrice(userId) {
    return getUserUnitPrice(userId);
  },

  // userId가 서로 다른 슬롯들을 한 번에 처리할 때(강제종료 배치 재접수 등) users 전체를
  // 한 번만 받아서 username -> unitPrice 맵으로 조회하기 위한 용도.
  async getUnitPriceMap() {
    try {
      const uSnap = await get(ref(db, PATHS.users));
      const map = {};
      snapToArray(uSnap).forEach(u => { map[u.username] = u.unitPrice || 0; });
      return map;
    } catch (e) { return {}; }
  },

  async addSlot(data) {
    const unitPriceSnapshot = (data.unitPrice != null) ? data.unitPrice : await getUserUnitPrice(data.userId || '');

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
  // 경로 하나를 실시간 구독 — 콜백엔 raw snapshot을 그대로 넘김(getDoc과 동일 형태).
  // 반환값은 구독 해제 함수.
  async subscribeDoc(path, callback) {
    await authReady;
    return onValue(ref(db, path), callback, e => console.error('subscribeDoc 구독 오류:', e));
  },

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
