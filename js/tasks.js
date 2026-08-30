// =====================================================
// 任務視窗溝通：開新視窗 + postMessage
// 對應「任務頁面通訊介面規格.md」
// =====================================================
import { deductTaskCost, claimTaskReward, awardBadge, awardCertificate } from './coins.js';
import { submitLeaderboardScore, fetchMyScore } from './leaderboard.js';

const openTaskWindows = new Map(); // taskId -> { win, origin }

// 定期清掉使用者手動關閉分頁（沒送 exit 訊息）的殘留記錄
setInterval(() => {
    for (const [taskId, entry] of openTaskWindows) {
        if (entry.win.closed) openTaskWindows.delete(taskId);
    }
}, 5000);

// 開啟任務：先扣款（若有），成功才真正開新視窗
export async function openTask(task, currentUser, onCoinsChanged) {
    if (!currentUser) {
        alert('請先登記通行證');
        return { ok: false };
    }

    // 扣款的同時平行查詢玩家在這個任務的個人最佳成績（架構調整討論記錄第四輪、方案A）：
    // 扣款本來就要 await，順便平行查成績幾乎不增加等待時間，查詢結果有 sessionStorage 快取。
    const [costResult, myScore] = await Promise.all([
        deductTaskCost(currentUser.uid, task, currentUser.coins, currentUser.dailyGuard),
        fetchMyScore(task.id, currentUser.uid)
    ]);
    if (!costResult.ok) {
        alert(costResult.reason);
        return { ok: false };
    }
    if (costResult.newCoins !== undefined) onCoinsChanged(costResult.newCoins, costResult.guard);

    // 務必在使用者點擊事件的同一個呼叫堆疊中直接呼叫 window.open，
    // 不要包在 await 之後，否則容易被手機瀏覽器的彈出視窗攔截器擋下。
    // （這裡扣款用 await，是刻意先確保扣款成功才開視窗；若擔心攔截問題，
    //  可改成「先開一個空白視窗、扣款成功後才設定 win.location」的寫法）
    const win = window.open(task.link, '_blank');
    if (!win) {
        alert('視窗被瀏覽器擋下了，請允許本網站開啟新分頁');
        return { ok: false };
    }

    const origin = new URL(task.link, location.href).origin;
    openTaskWindows.set(task.id, { win, origin, myScore });
    return { ok: true };
}

// 掛上全站唯一的訊息監聽器，在平台初始化時呼叫一次
export function initTaskMessageListener(getCurrentUser, onUserProfileChanged) {
    window.addEventListener('message', async (event) => {
        const msg = event.data;
        if (!msg || msg.source !== 'culture-task') return;

        const entry = openTaskWindows.get(msg.taskId);
        if (!entry) return;
        if (event.source !== entry.win) return;
        if (event.origin !== entry.origin) return;

        const currentUser = getCurrentUser();
        if (!currentUser) return;

        switch (msg.type) {
            case 'ready':
                // 回傳玩家資料給任務頁面：nickname/badges/certificates 平台記憶體裡已有，不用另外查；
                // myScore 是 openTask() 扣款當下平行查好、存在 entry 裡的個人最佳成績（可能是 null，代表沒玩過）。
                entry.win.postMessage({
                    source: 'culture-platform',
                    version: 1,
                    type: 'player_info',
                    payload: {
                        nickname: currentUser.nickname,
                        badges: currentUser.badges || [],
                        certificates: currentUser.certificates || [],
                        myScore: entry.myScore ?? null
                    }
                }, entry.origin);
                break;

            case 'complete': {
                const detail = { coinsAwarded: 0, badgesAwarded: [], certificatesAwarded: [] };
                let user = currentUser;

                if (msg.payload?.coins > 0) {
                    const r = await claimTaskReward(user.uid, msg.taskId, msg.payload.coins, user.coins, user.dailyGuard);
                    if (r.ok) {
                        detail.coinsAwarded = r.coinsAwarded;
                        user = { ...user, coins: r.newCoins ?? user.coins, dailyGuard: r.guard ?? user.dailyGuard };
                    } else {
                        detail.rejectedReason = r.reason;
                    }
                }
                for (const badgeId of msg.payload?.badgeIds || []) {
                    const r = await awardBadge(user.uid, msg.taskId, badgeId, user.badges, user.dailyGuard);
                    if (r.ok && !r.alreadyOwned) {
                        detail.badgesAwarded.push(badgeId);
                        user = { ...user, badges: r.badges, dailyGuard: r.guard ?? user.dailyGuard };
                    }
                }
                for (const certId of msg.payload?.certificateIds || []) {
                    const r = await awardCertificate(user.uid, msg.taskId, certId, user.certificates, user.dailyGuard);
                    if (r.ok && !r.alreadyOwned) {
                        detail.certificatesAwarded.push(certId);
                        user = { ...user, certificates: r.certificates, dailyGuard: r.guard ?? user.dailyGuard };
                    }
                }

                onUserProfileChanged(user);
                entry.win.postMessage({
                    source: 'culture-platform', version: 1, type: 'ack',
                    forType: 'complete', ok: true, result: detail
                }, entry.origin);
                break;
            }

            case 'score': {
                await submitLeaderboardScore(currentUser.uid, currentUser.nickname, msg.taskId, msg.payload);
                break;
            }

            case 'exit':
                openTaskWindows.delete(msg.taskId);
                break;
        }
    });
}
