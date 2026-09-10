// =====================================================
// 任務視窗溝通：開新視窗 + postMessage
// 對應「任務頁面通訊介面規格.md」
// =====================================================
import { deductTaskCost, claimTaskReward, awardBadge, awardCertificate, withRetry } from './coins.js';
import { submitLeaderboardScore, fetchMyScore } from './leaderboard.js';
import { db } from './firebase-config.js';
import { addDoc, collection } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const openTaskWindows = new Map(); // taskId -> { win, origin }

// 存到 localStorage 的退路 key：重試過還是寫不進 Firestore 時，先存在本機，
// 至少不會真的憑空消失、事後完全查不到。上限只留最新 200 筆，避免 localStorage 塞爆。
const FALLBACK_LOG_KEY = 'taskEventLogs_fallback';
function saveFallbackLog(entry) {
    try {
        const raw = localStorage.getItem(FALLBACK_LOG_KEY);
        const list = raw ? JSON.parse(raw) : [];
        list.push(entry);
        while (list.length > 200) list.shift();
        localStorage.setItem(FALLBACK_LOG_KEY, JSON.stringify(list));
    } catch { /* localStorage 也滿了或不可用，這種極端情況就真的沒辦法了 */ }
}

// ── 待補送寫入佇列：分數／金幣／徽章／證書重試過還是失敗時，存在這裡當退路 ──
// 跟上面的 FALLBACK_LOG_KEY 不一樣：那個只是「記一筆失敗了」的稽核記錄，這個是
// 「這筆資料本身還沒真的寫進去，之後要想辦法補寫」，兩者都要有、缺一不可。
const PENDING_WRITES_KEY = 'pendingTaskWrites';
const MAX_PENDING_ATTEMPTS = 5; // 補送到這個次數還失敗，多半是永久性的拒絕（例如規則不符），不再無限重試

function savePendingWrite(item) {
    try {
        const raw = localStorage.getItem(PENDING_WRITES_KEY);
        const list = raw ? JSON.parse(raw) : [];
        list.push({ ...item, attempts: 0, savedAt: Date.now() });
        while (list.length > 100) list.shift();
        localStorage.setItem(PENDING_WRITES_KEY, JSON.stringify(list));
    } catch { /* localStorage 也滿了或不可用，這種極端情況就真的沒辦法了 */ }
}

// 平台重新載入、使用者登入後呼叫：把本機待補送的分數/金幣/徽章/證書都試著重送一次。
// 只補送屬於「目前登入這個人」的項目——換了別的帳號在同一台裝置上用，
// Firestore 規則本來就不會讓你寫進別人的文件，硬送也只會一直失敗。
async function flushPendingWrites(currentUser) {
    if (!currentUser) return;
    let list;
    try {
        const raw = localStorage.getItem(PENDING_WRITES_KEY);
        list = raw ? JSON.parse(raw) : [];
    } catch { return; }
    if (!list.length) return;

    const remaining = [];
    for (const item of list) {
        if (item.uid !== currentUser.uid) { remaining.push(item); continue; } // 不是這個帳號的，先留著

        let r;
        try {
            if (item.kind === 'coins') r = await claimTaskReward(item.uid, item.taskId, item.amount);
            else if (item.kind === 'badge') r = await awardBadge(item.uid, item.taskId, item.badgeId);
            else if (item.kind === 'cert') r = await awardCertificate(item.uid, item.taskId, item.certId);
            else if (item.kind === 'score') r = await submitLeaderboardScore(item.uid, item.playerName, item.taskId, item.payload);
            else r = { ok: true }; // 不認得的種類，丟掉比留著卡住好
        } catch (err) {
            r = { ok: false, reason: err?.message };
        }

        if (r.ok) {
            logTaskEvent(item.uid, item.taskId, 'info', `本機待補送的 ${item.kind} 補寫成功`, { item });
        } else {
            const attempts = (item.attempts || 0) + 1;
            if (attempts >= MAX_PENDING_ATTEMPTS) {
                logTaskEvent(item.uid, item.taskId, 'error', `本機待補送的 ${item.kind} 重試 ${attempts} 次仍失敗，放棄補送`, { item, reason: r.reason });
            } else {
                remaining.push({ ...item, attempts });
            }
        }
    }
    try {
        if (remaining.length) localStorage.setItem(PENDING_WRITES_KEY, JSON.stringify(remaining));
        else localStorage.removeItem(PENDING_WRITES_KEY);
    } catch { /* 略過 */ }
}

// 平台重新載入時，試著把本機備份的記錄補送回 Firestore——不然本機備份只會一直
// 堆著、沒有出口。成功送出的就從本機清掉，失敗的留著、下次載入再試一次。
async function flushFallbackLogs() {
    let list;
    try {
        const raw = localStorage.getItem(FALLBACK_LOG_KEY);
        list = raw ? JSON.parse(raw) : [];
    } catch { return; }
    if (!list.length) return;

    const stillFailed = [];
    for (const entry of list) {
        try {
            await addDoc(collection(db, 'taskEventLogs'), entry);
        } catch {
            stillFailed.push(entry);
        }
    }
    try {
        if (stillFailed.length) localStorage.setItem(FALLBACK_LOG_KEY, JSON.stringify(stillFailed));
        else localStorage.removeItem(FALLBACK_LOG_KEY);
    } catch { /* 略過 */ }
}

// 把任務訊息處理過程中的關鍵事件寫進 Firestore（taskEventLogs），供事後在後台查，
// 不用即時盯著瀏覽器 console 看。同時也印一份到 console，方便當下有開著時直接看。
// 寫入失敗（例如離線）不應該讓任務處理流程跟著中斷，所以重試幾次、還是不行就存進
// localStorage 當退路，不要整個記錄悄悄不見、事後完全沒有痕跡可查。
function logTaskEvent(uid, taskId, level, message, extra) {
    if (level === 'error') console.error(`[tasks] ${message}`, extra || '');
    else if (level === 'warn') console.warn(`[tasks] ${message}`, extra || '');
    else console.log(`[tasks] ${message}`, extra || '');

    const entry = {
        uid: uid || null,
        taskId: taskId || null,
        level,
        message,
        extra: extra ? JSON.stringify(extra).slice(0, 2000) : null, // 避免單筆記錄太大
        at: Date.now()
    };

    withRetry(() => addDoc(collection(db, 'taskEventLogs'), entry), { retries: 1, delayMs: 500 })
        .catch(err => {
            console.warn('[tasks] 寫入 taskEventLogs 失敗，改存本機備份', err);
            saveFallbackLog(entry);
        });
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

    // 先在使用者點擊的同一個呼叫堆疊裡開一個空白分頁，保住瀏覽器判斷「這是使用者主動觸發」的
    // 資格——iOS Safari 對這件事特別嚴格，只要中間隔了一個 await 才呼叫 window.open，幾乎必定
    // 被彈出視窗攔截器擋下（先前的版本就是這樣寫壞的，註解寫著要小心但實作沒照做）。
    // 確認扣款/查成績都沒問題後，再把這個已經開好的分頁導向到真正的任務網址。
    const win = window.open('', '_blank');
    if (!win) {
        alert('視窗被瀏覽器擋下了，請允許本網站開啟新分頁');
        return { ok: false };
    }

    // 扣款的同時平行查詢玩家在這個任務的個人最佳成績（架構調整討論記錄第四輪、方案A）：
    // 扣款本來就要 await，順便平行查成績幾乎不增加等待時間，查詢結果有 sessionStorage 快取。
    const [costResult, myScore] = await Promise.all([
        deductTaskCost(currentUser.uid, task),
        fetchMyScore(task.id, currentUser.uid)
    ]);
    if (!costResult.ok) {
        win.close(); // 扣款失敗，把剛剛開好但還沒用到的空白分頁關掉，不留著一片空白的分頁
        alert(costResult.reason);
        return { ok: false };
    }
    if (costResult.newCoins !== undefined) onCoinsChanged(costResult.newCoins, costResult.guard);

    win.location = task.link;

    const origin = new URL(task.link, location.href).origin;
    openTaskWindows.set(task.id, { win, origin, myScore });
    return { ok: true };
}

// 掛上全站唯一的訊息監聽器，在平台初始化時呼叫一次
export function initTaskMessageListener(getCurrentUser, onUserProfileChanged) {
    flushFallbackLogs(); // 平台每次重新載入都試一次，之前補不進去的舊記錄有機會慢慢清空
    flushPendingWrites(getCurrentUser()); // 同樣道理，之前沒補送成功的分數/金幣/徽章/證書也試著補一次
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
                        const r = await claimTaskReward(user.uid, msg.taskId, msg.payload.coins);
                        if (r.ok) {
                            detail.coinsAwarded = r.coinsAwarded;
                            user = { ...user, coins: r.newCoins ?? user.coins, dailyGuard: r.guard ?? user.dailyGuard };
                            logTaskEvent(uid, msg.taskId, 'info', `金幣發放成功 +${r.coinsAwarded}`, { newCoins: r.newCoins, guard: r.guard });
                        } else {
                            detail.rejectedReason = r.reason;
                            logTaskEvent(uid, msg.taskId, 'warn', `金幣發放被拒絕：${r.reason}`, { requested: msg.payload.coins, guardBefore: user.dailyGuard, rawCode: r.rawCode, rawMessage: r.rawMessage });
                            savePendingWrite({ kind: 'coins', uid: user.uid, taskId: msg.taskId, amount: msg.payload.coins });
                        }
                    }
                    for (const badgeId of msg.payload?.badgeIds || []) {
                        const r = await awardBadge(user.uid, msg.taskId, badgeId);
                        if (r.ok && !r.alreadyOwned) {
                            detail.badgesAwarded.push(badgeId);
                            user = { ...user, badges: r.badges, dailyGuard: r.guard ?? user.dailyGuard };
                            logTaskEvent(uid, msg.taskId, 'info', `徽章 ${badgeId} 發放成功`);
                        } else if (r.ok && r.alreadyOwned) {
                            logTaskEvent(uid, msg.taskId, 'info', `徽章 ${badgeId} 已擁有，略過`);
                        } else {
                            logTaskEvent(uid, msg.taskId, 'warn', `徽章 ${badgeId} 發放失敗：${r.reason}`, { guardBefore: user.dailyGuard, rawCode: r.rawCode, rawMessage: r.rawMessage });
                            savePendingWrite({ kind: 'badge', uid: user.uid, taskId: msg.taskId, badgeId });
                        }
                    }
                    for (const certId of msg.payload?.certificateIds || []) {
                        const r = await awardCertificate(user.uid, msg.taskId, certId);
                        if (r.ok && !r.alreadyOwned) {
                            detail.certificatesAwarded.push(certId);
                            user = { ...user, certificates: r.certificates, dailyGuard: r.guard ?? user.dailyGuard };
                            logTaskEvent(uid, msg.taskId, 'info', `證書 ${certId} 發放成功`);
                        } else if (r.ok && r.alreadyOwned) {
                            logTaskEvent(uid, msg.taskId, 'info', `證書 ${certId} 已擁有，略過`);
                        } else {
                            logTaskEvent(uid, msg.taskId, 'warn', `證書 ${certId} 發放失敗：${r.reason}`, { guardBefore: user.dailyGuard });
                            savePendingWrite({ kind: 'cert', uid: user.uid, taskId: msg.taskId, certId });
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
                    if (r?.ok === false) {
                        savePendingWrite({ kind: 'score', uid: currentUser.uid, playerName: currentUser.nickname, taskId: msg.taskId, payload: msg.payload });
                    }
                } catch (err) {
                    logTaskEvent(uid, msg.taskId, 'error', 'score 處理過程發生未預期例外', { message: err?.message });
                    savePendingWrite({ kind: 'score', uid: currentUser.uid, playerName: currentUser.nickname, taskId: msg.taskId, payload: msg.payload });
                }
                break;
            }

            case 'exit':
                openTaskWindows.delete(msg.taskId);
                break;
        }
    });
}
