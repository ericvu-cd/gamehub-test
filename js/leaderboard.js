// =====================================================
// 排行榜：leaderboard/{taskId}/entries/{uid}
// 每位玩家每個任務只保留一筆「個人最佳成績」
// 對應功能規格書 6.9、8.4 節 + 架構調整討論記錄第三輪確認：
//   - 只查前 10 名（limit(10)），節省 Firestore 讀取額度
//   - 用 sessionStorage 快取，避免使用者反覆重整頁面重複計費
//   - 玩家交出更好成績時，成功寫入後立即刷新該任務的快取
// =====================================================
import { db } from './firebase-config.js';
import {
    doc, getDoc, setDoc, collection, getDocs, query, orderBy, limit
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const CACHE_PREFIX = 'lb_cache_';

function readCache(taskId) {
    try {
        const raw = sessionStorage.getItem(CACHE_PREFIX + taskId);
        return raw ? JSON.parse(raw) : null;
    } catch { return null; }
}

function writeCache(taskId, rows) {
    try { sessionStorage.setItem(CACHE_PREFIX + taskId, JSON.stringify(rows)); } catch { /* 略過寫入失敗 */ }
}

function clearCache(taskId) {
    try { sessionStorage.removeItem(CACHE_PREFIX + taskId); } catch { /* 略過 */ }
}

// 提交成績：只有比原本個人最佳成績更好時才會真的覆寫
export async function submitLeaderboardScore(uid, playerName, taskId, payload) {
    const { scoreLabel, scoreValue } = payload || {};
    if (typeof scoreValue !== 'number') return { ok: false, reason: '缺少 scoreValue' };

    const ref = doc(db, 'leaderboard', taskId, 'entries', uid);
    const existing = await getDoc(ref);

    if (existing.exists() && existing.data().scoreValue >= scoreValue) {
        return { ok: true, updated: false, reason: '未超過個人最佳成績，未更新' };
    }

    try {
        await setDoc(ref, { playerName, scoreLabel, scoreValue, updatedAt: Date.now() });
        clearCache(taskId); // 有更好的成績寫入，下次讀取要拿最新排行，不能用舊快取
        return { ok: true, updated: true };
    } catch (err) {
        return { ok: false, reason: err.message };
    }
}

// 讀取某任務的排行榜前 10 名，有 sessionStorage 快取時優先用快取（不佔讀取額度）
export async function fetchLeaderboard(taskId) {
    const cached = readCache(taskId);
    if (cached) return cached;

    const snap = await getDocs(query(
        collection(db, 'leaderboard', taskId, 'entries'),
        orderBy('scoreValue', 'desc'),
        limit(10)
    ));
    const rows = snap.docs.map(d => ({ uid: d.id, ...d.data() }));
    writeCache(taskId, rows);
    return rows;
}
