import { useItemTicket } from './itemTickets.js';
// =====================================================
// 任務視窗溝通：開新視窗 + postMessage
// 對應「任務頁面通訊介面規格.md」
// =====================================================
import { deductTaskCost, claimTaskReward, awardBadge, awardCertificate, withRetry, RETRYABLE_CODES } from './coins.js';
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
            r = { ok: false, reason: err?.message, rawCode: err?.code };
        }

        if (r.ok) {
            logTaskEvent(item.uid, item.taskId, 'info', `本機待補送的 ${item.kind} 補寫成功`, { item });
        } else if (r.rawCode && !RETRYABLE_CODES.has(r.rawCode)) {
            // 永久性錯誤（例如 permission-denied）：不管才重試第幾次，結果都一樣，
            // 立刻放棄、不要留著等下次重新載入頁面又再試一次——這種項目如果留著，
            // 每次重新載入都會再讀寫一次注定失敗的請求，白白浪費額度，
            // 之前就是這樣跟 withRetry 的重試疊加，把浪費放大了好幾倍。
            logTaskEvent(item.uid, item.taskId, 'error', `本機待補送的 ${item.kind} 遇到永久性錯誤，直接放棄補送`, { item, reason: r.reason, rawCode: r.rawCode });
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

// 定期清掉已經不存在的任務視窗記錄（保險用；任務視窗關閉時本來就會一併清掉）
setInterval(() => {
    for (const [taskId, entry] of openTaskWindows) {
        if (entry.win.closed) openTaskWindows.delete(taskId);
    }
}, 5000);

/* =====================================================================
   任務視窗：任務改成在平台畫面上蓋一層全螢幕視窗、嵌在裡面打開，不再開新分頁。
   原因：平台做成 PWA（加到主畫面）後，從 App 裡開新分頁在 iPhone 會跳去 Safari、
   在 Android 會開成有網址列的小瀏覽器視窗，都會露出網址，而且任務跟平台的連線會斷掉，
   金幣/徽章/分數送不回來。嵌在平台裡打開則一般瀏覽器跟 App 模式都能正常運作，
   也不再有「新分頁被瀏覽器擋下」的問題。
   任務端送訊息的方式不用改：任務偵測到自己被嵌在框架裡，本來就會把訊息送給上一層
   （window.parent），也就是這裡的平台。
   ===================================================================== */
let activeTaskOverlay = null;      // { taskId, el, iframe }
let taskOverlayClosedListener = null;

export function setTaskOverlayClosedListener(fn) { taskOverlayClosedListener = fn; }

function injectTaskOverlayStyles() {
    if (document.getElementById('task-overlay-style')) return;
    const style = document.createElement('style');
    style.id = 'task-overlay-style';
    style.textContent = `
    html.task-overlay-open, html.task-overlay-open body { overflow: hidden; }
    .task-overlay { position: fixed; inset: 0; z-index: 150; background: #000;
        display: flex; flex-direction: column; }
    .task-overlay-bar { flex: 0 0 auto; display: flex; align-items: center; gap: 10px;
        padding: calc(6px + env(safe-area-inset-top)) 10px 6px; background: #0c1230;
        border-bottom: 1px solid rgba(255,255,255,0.12); }
    .task-overlay-back { flex: 0 0 auto; border: none; border-radius: 16px; padding: 6px 12px;
        background: rgba(255,255,255,0.14); color: #fff; font-size: 13px; font-weight: 700;
        cursor: pointer; font-family: inherit; }
    .task-overlay-title { flex: 1 1 auto; min-width: 0; color: rgba(255,255,255,0.85); font-size: 13px;
        font-weight: 700; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; text-align: center;
        padding-right: 60px; }
    .task-overlay-body { position: relative; flex: 1 1 auto; min-height: 0; }
    /* 平板、寬螢幕：上方列與任務都限制成手機寬度、置中，兩側留黑底。
       任務頁面都是照手機直式設計的，很多沒有自己的寬度上限，直接撐滿平板會被拉得很寬。
       480px 跟平台本身的寬度上限一致；手機（寬度不到 480）完全不受影響。 */
    .task-overlay-bar, .task-overlay-body { box-sizing: border-box; width: 100%; max-width: 480px; margin-left: auto; margin-right: auto; }
    .task-overlay-frame { position: absolute; inset: 0; width: 100%; height: 100%; border: 0; background: #000; }
    .task-overlay-loading { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center;
        color: rgba(255,255,255,0.7); font-size: 14px; pointer-events: none; }
    `;
    style.textContent += ".task-cost-dialog::backdrop { background:rgba(0,0,0,.65); }";
    document.head.appendChild(style);
}

function createTaskOverlay(task) {
    injectTaskOverlayStyles();
    const el = document.createElement('div');
    el.className = 'task-overlay';
    el.innerHTML = `
        <div class="task-overlay-bar">
            <button type="button" class="task-overlay-back">← 返回平台</button>
            <div class="task-overlay-title"></div>
        </div>
        <div class="task-overlay-body">
            <div class="task-overlay-loading">任務載入中…</div>
            <iframe class="task-overlay-frame" allow="autoplay; fullscreen; screen-wake-lock"></iframe>
        </div>`;
    el.querySelector('.task-overlay-title').textContent = task.title || task.name || '';
    const iframe = el.querySelector('.task-overlay-frame');
    iframe.title = task.name || '任務';
    iframe.addEventListener('load', () => {
        const loading = el.querySelector('.task-overlay-loading');
        if (loading && iframe.getAttribute('src')) loading.remove();
    });
    // 平台自己的返回按鈕：不需要任務配合，任何任務（包含不跟平台溝通的）都能用它離開
    el.querySelector('.task-overlay-back').addEventListener('click', () => {
        if (window.confirm('確定要離開任務、返回平台嗎？\n目前這一局的進度不會被保留。')) {
            closeTaskOverlay(task.id);
        }
    });
    document.body.appendChild(el);
    document.documentElement.classList.add('task-overlay-open');
    return { el, iframe };
}

// 關閉任務視窗：任務送 exit 訊息、或玩家按平台的「返回平台」都會走到這裡
export function closeTaskOverlay(taskId) {
    if (!activeTaskOverlay) return;
    if (taskId && activeTaskOverlay.taskId !== taskId) return;
    const closedId = activeTaskOverlay.taskId;
    openTaskWindows.delete(closedId);
    activeTaskOverlay.el.remove();
    activeTaskOverlay = null;
    document.documentElement.classList.remove('task-overlay-open');
    if (taskOverlayClosedListener) {
        try { taskOverlayClosedListener(closedId); } catch (e) { console.error(e); }
    }
}

// 預載只下載資源，不建立 iframe、不執行任務程式。
let taskOpening = false;
const taskPreloads = new Map();
function preloadTaskHome(task) {
    const url = new URL(task.link, location.href);
    if (taskPreloads.has(url.href)) return;
    const hint = document.createElement('link');
    hint.rel = 'prefetch'; hint.as = 'document'; hint.href = url.href;
    document.head.appendChild(hint);
    const work = (async () => {
        const response = await fetch(url.href, { cache: 'force-cache', signal: AbortSignal.timeout(8000) });
        if (!response.ok) throw new Error('preload');
        const html = await response.text();
        const imageTags = html.match(/<img\b[^>]*>/gi) || [];
        const priority = imageTags.find(tag => /fetchpriority=["']high["']/i.test(tag));
        const src = priority?.match(/\bsrc=["']([^"']+)["']/i)?.[1]
            || html.match(/url\(\s*["']?([^\s)"']+\.(?:png|jpe?g|webp|avif)(?:\?[^\s)"']*)?)["']?\s*\)/i)?.[1]
            || imageTags.find(tag => /\bsrc=["'][^"']+["']/i.test(tag))?.match(/\bsrc=["']([^"']+)["']/i)?.[1];
        if (src) {
            const image = new Image();
            image.src = new URL(src, response.url || url.href).href;
        }
    })().catch(() => { taskPreloads.delete(url.href); });
    taskPreloads.set(url.href, work);
}
function confirmTaskCost(task) {
    injectTaskOverlayStyles();
    const dialog = document.createElement('dialog');
    dialog.className = 'task-cost-dialog';
    dialog.setAttribute('aria-labelledby', 'task-cost-title');
    dialog.style.cssText = 'width:min(340px,calc(100vw - 48px));box-sizing:border-box;border:1px solid #7185aa;border-radius:18px;padding:24px;background:#101a35;color:white;font-family:inherit;';
    dialog.innerHTML = '<h2 id="task-cost-title" style="font-size:20px;margin:0 0 14px">開始任務</h2><p data-name></p><p data-cost></p><div style="display:flex;gap:12px;margin-top:24px"><button type="button" data-cancel style="flex:1;padding:12px;border-radius:10px">取消</button><button type="button" data-agree style="flex:1;padding:12px;border-radius:10px;background:#71e2c4;color:#10253a;font-weight:bold">同意並開始</button></div>';
    dialog.querySelector('[data-name]').textContent = task.title || task.name || '任務';
    dialog.querySelector('[data-cost]').textContent = '本次進入需扣除 ' + task.entryCost + ' 金幣，是否開始？';
    document.body.appendChild(dialog);
    return new Promise(resolve => {
        let settled = false;
        const finish = agreed => {
            if (settled) return;
            settled = true; dialog.close(); dialog.remove(); resolve(agreed);
        };
        dialog.querySelector('[data-cancel]').onclick = () => finish(false);
        dialog.querySelector('[data-agree]').onclick = () => finish(true);
        dialog.addEventListener('cancel', event => { event.preventDefault(); finish(false); });
        dialog.showModal();
        dialog.querySelector('[data-cancel]').focus();
        preloadTaskHome(task);
    });
}

// 付費任務先確認並預載；同意後扣款成功才載入任務。
export async function openTask(task, currentUser, onCoinsChanged) {
    if (!currentUser) {
        alert('請先持船員證報到');
        return { ok: false };
    }
    if (activeTaskOverlay || taskOpening) return { ok: false }; // 已經有任務開著（理論上任務視窗會蓋住大廳，點不到）

    taskOpening = true;
    try {
        if (Number(task.entryCost) > 0 && !(await confirmTaskCost(task))) return { ok: false, cancelled: true };
        const { el, iframe } = createTaskOverlay(task);
        activeTaskOverlay = { taskId: task.id, el, iframe };

        // 扣款的同時平行查詢玩家在這個任務的個人最佳成績：扣款本來就要 await，
        // 順便平行查成績幾乎不增加等待時間，查詢結果有 sessionStorage 快取。
        const [costResult, myScore] = await Promise.all([
            deductTaskCost(currentUser.uid, task),
            fetchMyScore(task.id, currentUser.uid)
        ]);
        if (!costResult.ok) {
            closeTaskOverlay(task.id); // 扣款失敗，收掉還沒載入任務的視窗
            alert(costResult.reason);
            return { ok: false };
        }
        if (costResult.newCoins !== undefined) onCoinsChanged(costResult.newCoins, costResult.guard);

        // iframe.contentWindow 在同一個 iframe 裡換頁時仍是同一個物件，
        // 任務頁面載入後送來的訊息，event.source 會等於這裡記下的 win。
        const origin = new URL(task.link, location.href).origin;
        if (activeTaskOverlay?.el !== el) return { ok: false };
        openTaskWindows.set(task.id, { win: iframe.contentWindow, origin, myScore });
        iframe.src = task.link;
        return { ok: true };
    } finally { taskOpening = false; }
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
                        itemTickets: currentUser.itemTickets || [],
                        myScore: entry.myScore ?? null
                    }
                }, entry.origin);
                break;

            case 'use_item_ticket': {
                const { itemId, requestId } = msg.payload || {};
                const result = await useItemTicket(uid, msg.taskId, itemId, requestId);
                if (getCurrentUser()?.uid !== uid || openTaskWindows.get(msg.taskId) !== entry) break;
                if (result.itemTickets) onUserProfileChanged({ ...getCurrentUser(), itemTickets: result.itemTickets, dailyGuard: result.guard ?? getCurrentUser().dailyGuard });
                entry.win.postMessage({ source: 'culture-platform', version: 1, taskId: msg.taskId,
                    type: 'item_ticket_result', requestId, itemId, ...result }, entry.origin);
                break;
            }

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
                closeTaskOverlay(msg.taskId); // 任務自己的「關閉／返回」：收掉平台上的任務視窗
                break;
        }
    });
}

