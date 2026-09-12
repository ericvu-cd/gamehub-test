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
//
// 減少讀取量的兩個調整（架構調整討論記錄第五輪）：
//   1. 快取從 sessionStorage 改成 localStorage + 時間戳記：原本 sessionStorage 只要分頁一關
//      就整個失效，玩家換分頁/重開瀏覽器都要重新查一次；改成 localStorage 並帶著時間戳記，
//      在效期內（TOP10_CACHE_TTL_MS）不管開幾次分頁都直接用快取，過期才真的重查。
//   2. 前十名改成讀「排行榜快照」單一文件（leaderboardSummary/{taskId}），而不是每次都
//      對 leaderboard/{taskId}/entries 下 orderBy+limit(10) 查詢——後者每次沒快取都是
//      10 次讀取（讀幾筆算幾次），快照只要讀 1 份文件＝1 次讀取。快照只在玩家真的
//      破紀錄、可能擠進前十名時才更新（見 submitLeaderboardScore 內的 updateLeaderboardSnapshot），
//      這種情況本來就有 gate 擋著、不常發生，用「查詢次數遠多於破紀錄次數」換算下來非常划算。
// =====================================================
import { db } from './firebase-config.js';
import {
    doc, getDoc, setDoc, runTransaction, collection, getDocs, query, orderBy, limit
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { withRetry } from './coins.js';

const CACHE_PREFIX = 'lb_cache_';
const MY_SCORE_CACHE_PREFIX = 'my_score_';
const TOP10_CACHE_TTL_MS = 5 * 60 * 1000; // 前十名快取效期：5 分鐘

function readCache(taskId) {
    try {
        const raw = localStorage.getItem(CACHE_PREFIX + taskId);
        if (!raw) return null;
        const { rows, at } = JSON.parse(raw);
        if (Date.now() - at > TOP10_CACHE_TTL_MS) return null; // 過期，當作沒有快取
        return rows;
    } catch { return null; }
}

function writeCache(taskId, rows) {
    try { localStorage.setItem(CACHE_PREFIX + taskId, JSON.stringify({ rows, at: Date.now() })); } catch { /* 略過寫入失敗 */ }
}

function clearCache(taskId) {
    try { localStorage.removeItem(CACHE_PREFIX + taskId); } catch { /* 略過 */ }
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

// 更新「排行榜前十名快照」：用 runTransaction 讀取目前快照、把這筆新成績併進去重新
// 排序取前十，寫回同一份文件。只有 submitLeaderboardScore 判斷「真的破紀錄」時才會呼叫，
// 平常查看排行榜完全不會走到這裡，不會增加查詢端的負擔。
async function updateLeaderboardSnapshot(taskId, uid, playerName, scoreLabel, scoreValue) {
    const snapRef = doc(db, 'leaderboardSummary', taskId);
    try {
        await withRetry(() => runTransaction(db, async (tx) => {
            const snap = await tx.get(snapRef);
            let entries = snap.exists() ? (snap.data().entries || []) : [];
            entries = entries.filter(e => e.uid !== uid); // 先移除這位玩家的舊資料，避免重複
            entries.push({ uid, playerName, scoreLabel, scoreValue });
            entries.sort((a, b) => b.scoreValue - a.scoreValue);
            entries = entries.slice(0, 10);
            tx.set(snapRef, { entries, updatedAt: Date.now() });
        }));
    } catch (err) {
        // 快照更新失敗不影響玩家分數本身已經寫入成功，只是「前十名顯示」這塊可能暫時
        // 不是最新，下次有人破紀錄時還是會再嘗試更新，不用特別處理、印個警告即可。
        console.warn('[leaderboard] 更新排行榜快照失敗', err);
    }
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
            await updateLeaderboardSnapshot(taskId, uid, playerName, scoreLabel, scoreValue);
        }
        return result;
    } catch (err) {
        return { ok: false, reason: err.message, rawCode: err?.code };
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

// 讀取某任務的排行榜前 10 名：改讀快照文件（1 次讀取），不再對 entries 下
// orderBy+limit(10) 查詢（10 次讀取）。有本機快取（5 分鐘內）時優先用快取，完全不佔額度。
//
// ⚠️ 新舊資料銜接：leaderboardSummary 是全新的集合，上線當下是空的，既有的歷史
// 成績都還在 leaderboard/{taskId}/entries 裡（後台管理畫面看到的就是這份）。
// 如果快照文件還不存在，就自動退回舊的查詢方式抓一次（只有這一次是 10 次讀取），
// 順便把結果回填進快照——之後同一個任務的查詢就都能吃到快照的低成本，
// 不需要另外寫一次性的遷移程式。
export async function fetchLeaderboard(taskId) {
    const cached = readCache(taskId);
    if (cached) return cached;

    const snapRef = doc(db, 'leaderboardSummary', taskId);
    const snap = await getDoc(snapRef);
    let rows;
    if (snap.exists()) {
        rows = snap.data().entries || [];
    } else {
        // 快照還沒建立過（新任務，或這是上線後第一次查詢這個任務）：退回舊方式查一次
        const oldSnap = await getDocs(query(
            collection(db, 'leaderboard', taskId, 'entries'),
            orderBy('scoreValue', 'desc'),
            limit(10)
        ));
        rows = oldSnap.docs.map(d => ({ uid: d.id, ...d.data() }));
        setDoc(snapRef, { entries: rows, updatedAt: Date.now() }).catch(() => {
            // 回填失敗不影響這次查詢結果本身，只是下次可能又要再查一次舊方式，略過即可
        });
    }
    writeCache(taskId, rows);
    return rows;
}
