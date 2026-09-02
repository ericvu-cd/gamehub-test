// =====================================================
// 任務視窗溝通：開新視窗 + postMessage
// 對應「任務頁面通訊介面規格.md」
// =====================================================
import { deductTaskCost, claimTaskReward, awardBadge, awardCertificate } from './coins.js';
import { submitLeaderboardScore, fetchMyScore } from './leaderboard.js';
import { db } from './firebase-config.js';
import { addDoc, collection } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const openTaskWindows = new Map(); // taskId -> { win, origin }

// 把任務訊息處理過程中的關鍵事件寫進 Firestore（taskEventLogs），供事後在後台查，
// 不用即時盯著瀏覽器 console 看。同時也印一份到 console，方便當下有開著時直接看。
// 寫入失敗（例如離線）不應該讓任務處理流程跟著中斷，所以用 catch 吞掉、只印警告。
function logTaskEvent(uid, taskId, level, message, extra) {
    if (level === 'error') console.error(`[tasks] ${message}`, extra || '');
    else if (level === 'warn') console.warn(`[tasks] ${message}`, extra || '');
    else console.log(`[tasks] ${message}`, extra || '');

    addDoc(collection(db, 'taskEventLogs'), {
        uid: uid || null,
        taskId: taskId || null,
        level,
        message,
        extra: extra ? JSON.stringify(extra).slice(0, 2000) : null, // 避免單筆記錄太大
        at: Date.now()
    }).catch(err => console.warn('[tasks] 寫入 taskEventLogs 失敗', err));
}

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

        const currentUser = getCurrentUser(); // 提前取得，讓下面每一個記錄點都能帶上 uid
        const uid = currentUser?.uid || null;

        const entry = openTaskWindows.get(msg.taskId);
        if (!entry) {
            logTaskEvent(uid, msg.taskId, 'warn', `收到 ${msg.type} 訊息但 openTaskWindows 查無記錄（分頁可能已判定關閉、或根本沒開過），訊息被忽略`);
            return;
        }
        if (event.source !== entry.win) {
            logTaskEvent(uid, msg.taskId, 'warn', `收到 ${msg.type} 訊息但 event.source 跟記錄的視窗物件不一致，訊息被忽略`);
            return;
        }
        if (event.origin !== entry.origin) {
            logTaskEvent(uid, msg.taskId, 'warn', `收到 ${msg.type} 訊息但 origin 不符，訊息被忽略`, { expected: entry.origin, actual: event.origin });
            return;
        }
        if (!currentUser) {
            logTaskEvent(null, msg.taskId, 'warn', `收到 ${msg.type} 訊息但目前沒有登入中的使用者，訊息被忽略`);
            return;
        }

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
                logTaskEvent(uid, msg.taskId, 'info', 'complete 訊息開始處理', msg.payload);

                try {
                    if (msg.payload?.coins > 0) {
                        const r = await claimTaskReward(user.uid, msg.taskId, msg.payload.coins, user.coins, user.dailyGuard);
                        if (r.ok) {
                            detail.coinsAwarded = r.coinsAwarded;
                            user = { ...user, coins: r.newCoins ?? user.coins, dailyGuard: r.guard ?? user.dailyGuard };
                            logTaskEvent(uid, msg.taskId, 'info', `金幣發放成功 +${r.coinsAwarded}`, { newCoins: r.newCoins, guard: r.guard });
                        } else {
                            detail.rejectedReason = r.reason;
                            logTaskEvent(uid, msg.taskId, 'warn', `金幣發放被拒絕：${r.reason}`, { requested: msg.payload.coins, guardBefore: user.dailyGuard });
                        }
                    }
                    for (const badgeId of msg.payload?.badgeIds || []) {
                        const r = await awardBadge(user.uid, msg.taskId, badgeId, user.badges, user.dailyGuard);
                        if (r.ok && !r.alreadyOwned) {
                            detail.badgesAwarded.push(badgeId);
                            user = { ...user, badges: r.badges, dailyGuard: r.guard ?? user.dailyGuard };
                            logTaskEvent(uid, msg.taskId, 'info', `徽章 ${badgeId} 發放成功`);
                        } else if (r.ok && r.alreadyOwned) {
                            logTaskEvent(uid, msg.taskId, 'info', `徽章 ${badgeId} 已擁有，略過`);
                        } else {
                            logTaskEvent(uid, msg.taskId, 'warn', `徽章 ${badgeId} 發放失敗：${r.reason}`, { guardBefore: user.dailyGuard });
                        }
                    }
                    for (const certId of msg.payload?.certificateIds || []) {
                        const r = await awardCertificate(user.uid, msg.taskId, certId, user.certificates, user.dailyGuard);
                        if (r.ok && !r.alreadyOwned) {
                            detail.certificatesAwarded.push(certId);
                            user = { ...user, certificates: r.certificates, dailyGuard: r.guard ?? user.dailyGuard };
                            logTaskEvent(uid, msg.taskId, 'info', `證書 ${certId} 發放成功`);
                        } else if (r.ok && r.alreadyOwned) {
                            logTaskEvent(uid, msg.taskId, 'info', `證書 ${certId} 已擁有，略過`);
                        } else {
                            logTaskEvent(uid, msg.taskId, 'warn', `證書 ${certId} 發放失敗：${r.reason}`, { guardBefore: user.dailyGuard });
                        }
                    }
                } catch (err) {
                    // 任一步驟拋出未預期的例外時，至少要留下記錄，不能整個靜默消失
                    detail.rejectedReason = detail.rejectedReason || (err?.message || '處理過程發生未預期錯誤');
                    logTaskEvent(uid, msg.taskId, 'error', 'complete 處理過程發生未預期例外', { message: err?.message, stack: err?.stack });
                }

                logTaskEvent(uid, msg.taskId, 'info', 'complete 處理完成', detail);
                onUserProfileChanged(user);
                entry.win.postMessage({
                    source: 'culture-platform', version: 1, type: 'ack',
                    forType: 'complete', ok: true, result: detail
                }, entry.origin);
                break;
            }

            case 'score': {
                try {
                    const r = await submitLeaderboardScore(currentUser.uid, currentUser.nickname, msg.taskId, msg.payload);
                    logTaskEvent(uid, msg.taskId, r?.ok === false ? 'warn' : 'info', 'score 訊息處理完成', { payload: msg.payload, result: r });
                } catch (err) {
                    logTaskEvent(uid, msg.taskId, 'error', 'score 處理過程發生未預期例外', { message: err?.message });
                }
                break;
            }

            case 'exit':
                openTaskWindows.delete(msg.taskId);
                break;
        }
    });
}
