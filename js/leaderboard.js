// =====================================================
// 排行榜：leaderboard/{taskId}/entries/{uid}
// 每位玩家每個任務只保留一筆「個人最佳成績」
// 對應功能規格書 6.9、8.4 節 + 架構調整討論記錄第三輪確認：
//   - 只查前 10 名（limit(10)），節省 Firestore 讀取額度
//   - 用 sessionStorage 快取，避免使用者反覆重整頁面重複計費
//   - 玩家交出更好成績時，成功寫入後立即刷新該任務的快取
// 另外，架構調整討論記錄第四輪定案：
//   - 「我的成績」用獨立快取（my_score_ 前綴），跟前十名快取（lb_cache_）分開，互不影響
//   - 快取要能區分「還沒查過」跟「查過、結果是沒玩過（null）」，見 MY_SCORE_CACHE_PREFIX 相關函式
//   - 玩家交出更好成績時，快取用「就地覆寫」，不清掉重查（見 submitLeaderboardScore 內的 writeMyScoreCache）
// =====================================================
import { db } from './firebase-config.js';
import {
    doc, getDoc, setDoc, collection, getDocs, query, orderBy, limit
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { withRetry } from './coins.js';

const CACHE_PREFIX = 'lb_cache_';
const MY_SCORE_CACHE_PREFIX = 'my_score_';

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

// 讀「我的成績」快取，回傳 { fetched: true, value } 或 null（null 代表這個分頁還沒查過）
// ⚠️ key 一定要包含 uid，不能只用 taskId——sessionStorage 是跟著瀏覽器分頁走的，
// 不是跟著登入帳號走的。同一個分頁如果先後登入過不同帳號（例如測試多個玩家），
// 只用 taskId 當 key 會讓後面登入的帳號直接讀到前一個帳號留下的快取值，
// 誤以為自己有一個根本不屬於自己的歷史最佳成績。
function readMyScoreCache(taskId, uid) {
    try {
        const raw = sessionStorage.getItem(MY_SCORE_CACHE_PREFIX + uid + '_' + taskId);
        return raw ? JSON.parse(raw) : null;
    } catch { return null; }
}

// 寫「我的成績」快取，value 為 null 代表「查過了，但這個玩家沒玩過這個任務」
function writeMyScoreCache(taskId, uid, value) {
    try {
        sessionStorage.setItem(MY_SCORE_CACHE_PREFIX + uid + '_' + taskId, JSON.stringify({ fetched: true, value }));
    } catch { /* 略過寫入失敗 */ }
}

// 提交成績：只有比原本個人最佳成績更好時才會真的覆寫
export async function submitLeaderboardScore(uid, playerName, taskId, payload) {
    const { scoreLabel, scoreValue } = payload || {};
    if (typeof scoreValue !== 'number') return { ok: false, reason: '缺少 scoreValue' };

    const ref = doc(db, 'leaderboard', taskId, 'entries', uid);

    try {
        // 讀取＋比較＋寫入包在同一個重試裡：短暫網路抖動導致的失敗，整段重來一次
        // 是安全的（每次重算的結果都一樣，不會因為重試造成分數被錯誤覆寫）。
        const result = await withRetry(async () => {
            const existing = await getDoc(ref);
            if (existing.exists() && existing.data().scoreValue >= scoreValue) {
                return { ok: true, updated: false, reason: '未超過個人最佳成績，未更新' };
            }
            await setDoc(ref, { playerName, scoreLabel, scoreValue, updatedAt: Date.now() });
            return { ok: true, updated: true };
        });
        if (result.updated) {
            clearCache(taskId); // 有更好的成績寫入，下次讀取要拿最新排行，不能用舊快取
            writeMyScoreCache(taskId, uid, { scoreLabel, scoreValue }); // 就地覆寫，不用再多打一次 Firestore 確認
        }
        return result;
    } catch (err) {
        return { ok: false, reason: err.message };
    }
}

// 查詢玩家自己在某任務的個人最佳成績；有快取（含「查過但沒玩過」）時優先用快取，不佔讀取額度
export async function fetchMyScore(taskId, uid) {
    const cached = readMyScoreCache(taskId, uid);
    if (cached && cached.fetched) return cached.value;

    const ref = doc(db, 'leaderboard', taskId, 'entries', uid);
    const snap = await getDoc(ref);
    const value = snap.exists()
        ? { scoreLabel: snap.data().scoreLabel, scoreValue: snap.data().scoreValue }
        : null;
    writeMyScoreCache(taskId, uid, value);
    return value;
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
