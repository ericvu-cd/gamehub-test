// =====================================================
// 任務視窗溝通：開新視窗 + postMessage
// 對應「任務頁面通訊介面規格.md」
// =====================================================
import { deductTaskCost, claimTaskReward, awardBadge, awardCertificate } from './coins.js';
import { submitLeaderboardScore } from './leaderboard.js';

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

    const costResult = await deductTaskCost(currentUser.uid, task.id, currentUser.coins);
    if (!costResult.ok) {
        alert(costResult.reason);
        return { ok: false };
    }
    if (costResult.newCoins !== undefined) onCoinsChanged(costResult.newCoins);

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
    openTaskWindows.set(task.id, { win, origin });
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
                break;

            case 'complete': {
                const detail = { coinsAwarded: 0, badgesAwarded: [], certificatesAwarded: [] };
                let user = currentUser;

                if (msg.payload?.coins > 0) {
                    const r = await claimTaskReward(user.uid, msg.taskId, msg.payload.coins, user.coins);
                    if (r.ok) {
                        detail.coinsAwarded = r.coinsAwarded;
                        user = { ...user, coins: r.newCoins ?? user.coins };
                    }
                }
                for (const badgeId of msg.payload?.badgeIds || []) {
                    const r = await awardBadge(user.uid, msg.taskId, badgeId, user.badges);
                    if (r.ok && !r.alreadyOwned) {
                        detail.badgesAwarded.push(badgeId);
                        user = { ...user, badges: r.badges };
                    }
                }
                for (const certId of msg.payload?.certificateIds || []) {
                    const r = await awardCertificate(user.uid, msg.taskId, certId, user.certificates);
                    if (r.ok && !r.alreadyOwned) {
                        detail.certificatesAwarded.push(certId);
                        user = { ...user, certificates: r.certificates };
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
