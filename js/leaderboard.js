// =====================================================
// 排行榜：leaderboard/{taskId}/entries/{uid}
// 每位玩家每個任務只保留一筆「個人最佳成績」
// 對應功能規格書 6.9、8.4 節
// =====================================================
import { db } from './firebase-config.js';
import {
    doc, getDoc, setDoc, collection, getDocs, query, orderBy
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

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
        return { ok: true, updated: true };
    } catch (err) {
        return { ok: false, reason: err.message };
    }
}

// 讀取某任務的完整排行榜（單頁顯示全部，不分頁，見規格書 6.9 節）
export async function fetchLeaderboard(taskId) {
    const snap = await getDocs(query(
        collection(db, 'leaderboard', taskId, 'entries'),
        orderBy('scoreValue', 'desc')
    ));
    return snap.docs.map(d => ({ uid: d.id, ...d.data() }));
}
