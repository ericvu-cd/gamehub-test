// =====================================================
// 通行金幣異動邏輯（GitHub 遷移版）
// ⚠️ 任務資料（entryCost）已搬到 GitHub，Firestore 規則無法再逐筆核對
// 交易金額，改用「每人每日總量防護」（dailyGuard）：
//   - DAILY_CAP = 200：今天淨增加的金幣總額上限
//   - MAX_TX_PER_DAY = 100：今天的異動次數上限
// 這裡的寫法必須跟 firestore.rules 的 dailyGuard 驗證邏輯完全對應。
// 對應「架構調整討論記錄.md」第三輪確認的設計。
// =====================================================
import { db } from './firebase-config.js';
import { doc, collection, runTransaction } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

// ── 通用重試包裝：短暫的網路抖動、Firestore 一時連不上，重試一兩次多半就過了 ──
// 原本任何 Firestore 讀寫只要失敗一次就直接放棄，玩家的分數/徽章/連稽核記錄
// 都可能因為那一瞬間的網路問題就悄悄不見、事後也查不到任何痕跡。
// 注意：只適合包住「本身就具備冪等性」的操作（runTransaction 本來就是全有全無；
// getDoc+setDoc 這種讀取後覆寫的也是每次重算都一樣的結果），不會因為重試造成重複寫入。
// Firestore 的錯誤代碼裡，只有這幾種是「暫時性」的（網路不穩、伺服器忙線），
// 重試才有意義；其他像 permission-denied（規則拒絕）、invalid-argument（參數本身有問題）
// 這種，不管重試幾次、間隔多久，用同樣的資料算出來的結果一定還是被拒絕，
// 重試只是白白浪費讀寫額度，之前沒分這個，每一次真正的拒絕都變成 3 倍的無謂讀寫。
export const RETRYABLE_CODES = new Set([
    'unavailable', 'deadline-exceeded', 'aborted', 'cancelled', 'internal', 'unknown'
]);

export async function withRetry(fn, { retries = 2, delayMs = 400 } = {}) {
    let lastErr;
    for (let attempt = 0; attempt <= retries; attempt++) {
        try {
            return await fn();
        } catch (err) {
            lastErr = err;
            const retryable = !err?.code || RETRYABLE_CODES.has(err.code);
            if (!retryable) throw err; // 永久性錯誤：立刻丟出去，不再重試
            if (attempt < retries) {
                await new Promise(resolve => setTimeout(resolve, delayMs * (attempt + 1)));
            }
        }
    }
    throw lastErr;
}

function utc8DayNumber(date = new Date()) {
    return Math.floor((date.getTime() + 8 * 60 * 60 * 1000) / (24 * 60 * 60 * 1000));
}

function friendlyError(err) {
    // 保留原始 code/message，不要只留翻譯過的說法——不然像這次「已達上限」
    // 這種通用說法會把「其實是別的規則不符合」的真正原因蓋掉，事後完全查不出來。
    const raw = { rawCode: err?.code || null, rawMessage: err?.message || null };
    if (err?.code === 'permission-denied') {
        return { ok: false, reason: '今天的異動次數或金額已達上限，請明天再試', ...raw };
    }
    return { ok: false, reason: err?.message || '發生未知錯誤', ...raw };
}

// 計算這次異動後，dailyGuard 應該變成什麼樣子（今天第一次異動要重置歸零再累計）
function nextDailyGuard(currentGuard, netDelta) {
    const today = utc8DayNumber();
    const isNewDay = !currentGuard || currentGuard.day !== today;
    const prevNet = isNewDay ? 0 : (currentGuard.netChange || 0);
    const prevTx = isNewDay ? 0 : (currentGuard.txCount || 0);
    return { day: today, netChange: prevNet + netDelta, txCount: prevTx + 1 };
}

// --- 每日登入獎勵 ---
// 改用 runTransaction：跟 claimTaskReward 同樣理由，讀「當下最新」的 coins/dailyGuard
// 去算，不能用呼叫者傳進來的舊快照，不然快照過期會被 Firestore 規則拒絕、
// 或錯誤覆寫掉別的地方剛寫好的結果。
export async function claimDailyLogin(uid) {
    const today = utc8DayNumber();
    const userRef = doc(db, 'users', uid);

    try {
        const result = await withRetry(() => runTransaction(db, async (tx) => {
            const snap = await tx.get(userRef);
            const data = snap.data();
            if (data.lastDailyLoginDay === today) return { alreadyClaimed: true };

            const newCoins = (data.coins || 0) + 10;
            const guard = nextDailyGuard(data.dailyGuard, 10);

            tx.update(userRef, {
                lastDailyLoginDay: today,
                coins: newCoins,
                dailyGuard: guard,
                lastTransaction: { type: 'daily_login', amount: 10, taskId: null, at: Date.now() }
            });
            const ledgerRef = doc(collection(db, 'coinLedger', uid, 'entries'));
            tx.set(ledgerRef, {
                type: 'daily_login', amount: 10, balanceAfter: newCoins,
                relatedTaskId: null, note: '', createdAt: Date.now()
            });
            return { alreadyClaimed: false, newCoins, guard };
        }));
        if (result.alreadyClaimed) return { ok: true, alreadyClaimed: true };
        return { ok: true, newCoins: result.newCoins, guard: result.guard };
    } catch (err) {
        return friendlyError(err);
    }
}

// --- 進入任務扣款（task 為 content.js 讀回的任務物件，含 entryCost） ---
export async function deductTaskCost(uid, task) {
    const cost = task.entryCost || 0;
    if (cost <= 0) return { ok: true, cost: 0 };

    const userRef = doc(db, 'users', uid);
    try {
        const result = await withRetry(() => runTransaction(db, async (tx) => {
            const snap = await tx.get(userRef);
            const data = snap.data();
            const currentCoins = data.coins || 0;
            if (currentCoins < cost) {
                return { insufficient: true };
            }

            const newCoins = currentCoins - cost;
            const guard = nextDailyGuard(data.dailyGuard, -cost);
            tx.update(userRef, {
                coins: newCoins,
                dailyGuard: guard,
                lastTransaction: { type: 'task_cost', amount: cost, taskId: task.id, at: Date.now() }
            });
            const ledgerRef = doc(collection(db, 'coinLedger', uid, 'entries'));
            tx.set(ledgerRef, {
                type: 'task_cost', amount: -cost, balanceAfter: newCoins,
                relatedTaskId: task.id, note: '', createdAt: Date.now()
            });
            return { insufficient: false, newCoins, guard };
        }));
        if (result.insufficient) return { ok: false, reason: `通行金幣不足，需要 ${cost} 枚` };
        return { ok: true, newCoins: result.newCoins, cost, guard: result.guard };
    } catch (err) {
        return friendlyError(err);
    }
}

// --- 商店兌換：扣款樣式基本上跟 deductTaskCost 一樣，但額外多寫一筆 shopRedemptions
//     紀錄（玩家兌換成功後要給店家看的那筆「收據」），單筆金額上限用 MAX_SHOP_ITEM_COST，
//     跟任務用的 MAX_SINGLE_TX 分開算（見 firestore.rules 開頭的參數說明） ---
export async function redeemShopItem(uid, item) {
    const cost = item.cost || 0;
    if (cost <= 0) return { ok: false, reason: '這個品項尚未設定兌換價格' };

    const userRef = doc(db, 'users', uid);
    try {
        const result = await withRetry(() => runTransaction(db, async (tx) => {
            const snap = await tx.get(userRef);
            const data = snap.data();
            const currentCoins = data.coins || 0;
            if (currentCoins < cost) return { insufficient: true };

            const newCoins = currentCoins - cost;
            const guard = nextDailyGuard(data.dailyGuard, -cost);
            const redeemedAt = Date.now();

            tx.update(userRef, {
                coins: newCoins,
                dailyGuard: guard,
                lastTransaction: { type: 'shop_redemption', amount: cost, taskId: null, at: redeemedAt }
            });
            const ledgerRef = doc(collection(db, 'coinLedger', uid, 'entries'));
            tx.set(ledgerRef, {
                type: 'shop_redemption', amount: -cost, balanceAfter: newCoins,
                relatedTaskId: null, note: `商店兌換：${item.name}`, createdAt: redeemedAt
            });
            const redemptionRef = doc(collection(db, 'shopRedemptions', uid, 'entries'));
            tx.set(redemptionRef, {
                itemId: item.id, itemName: item.name, cost, redeemedAt
            });
            return { insufficient: false, newCoins, guard, redemption: { itemName: item.name, cost, redeemedAt } };
        }));
        if (result.insufficient) return { ok: false, reason: `通行金幣不足，需要 ${cost} 枚` };
        return { ok: true, newCoins: result.newCoins, cost, guard: result.guard, redemption: result.redemption };
    } catch (err) {
        return friendlyError(err);
    }
}

// --- 任務獎勵（不再核對任務個別上限，改受當日總量防護限制） ---
// 改用 runTransaction：短時間內多個任務視窗同時各自送 complete 訊息時
// （例如一次解鎖好幾個徽章、各自送一則），每一筆都要讀「當下最新」的
// coins/dailyGuard 去算，不能用呼叫者傳進來的舊快照，不然快照過期的那幾筆
// 會各自根據舊資料算出新值、互相覆寫掉別人剛寫好的結果（遺失更新）。
// runTransaction 會自動偵測衝突並重試，讀到的一定是當下最新資料。
export async function claimTaskReward(uid, taskId, requestedAmount) {
    if (!requestedAmount || requestedAmount <= 0) return { ok: true, coinsAwarded: 0 };

    const userRef = doc(db, 'users', uid);
    try {
        const result = await withRetry(() => runTransaction(db, async (tx) => {
            const snap = await tx.get(userRef);
            const data = snap.data();
            const newCoins = (data.coins || 0) + requestedAmount;
            const guard = nextDailyGuard(data.dailyGuard, requestedAmount);

            tx.update(userRef, {
                coins: newCoins,
                dailyGuard: guard,
                lastTransaction: { type: 'task_reward', amount: requestedAmount, taskId, at: Date.now() }
            });
            const ledgerRef = doc(collection(db, 'coinLedger', uid, 'entries'));
            tx.set(ledgerRef, {
                type: 'task_reward', amount: requestedAmount, balanceAfter: newCoins,
                relatedTaskId: taskId, note: '', createdAt: Date.now()
            });
            return { newCoins, guard };
        }));
        return { ok: true, coinsAwarded: requestedAmount, newCoins: result.newCoins, guard: result.guard };
    } catch (err) {
        return friendlyError(err);
    }
}

// --- 授予徽章（不再核對來源任務，見架構調整討論記錄第三輪確認） ---
// 同樣改用 runTransaction，理由跟上面 claimTaskReward 一樣：badges 陣列跟
// dailyGuard 都要讀「當下最新」的去算，才不會被同時進來的其他徽章覆寫掉。
export async function awardBadge(uid, taskId, badgeId) {
    const userRef = doc(db, 'users', uid);
    try {
        const result = await withRetry(() => runTransaction(db, async (tx) => {
            const snap = await tx.get(userRef);
            const data = snap.data();
            const currentBadges = data.badges || [];
            if (currentBadges.includes(badgeId)) return { alreadyOwned: true };

            const newBadges = [...currentBadges, badgeId];
            const guard = nextDailyGuard(data.dailyGuard, 0);
            tx.update(userRef, {
                badges: newBadges,
                dailyGuard: guard,
                lastTransaction: { type: 'collectible_award', taskId, at: Date.now() }
            });
            return { alreadyOwned: false, badges: newBadges, guard };
        }));
        if (result.alreadyOwned) return { ok: true, alreadyOwned: true };
        return { ok: true, badges: result.badges, guard: result.guard };
    } catch (err) {
        return friendlyError(err);
    }
}

// --- 授予證書（同上，不核對來源任務） ---
export async function awardCertificate(uid, taskId, certificateId) {
    const userRef = doc(db, 'users', uid);
    try {
        const result = await withRetry(() => runTransaction(db, async (tx) => {
            const snap = await tx.get(userRef);
            const data = snap.data();
            const currentCerts = data.certificates || [];
            if (currentCerts.includes(certificateId)) return { alreadyOwned: true };

            const newCerts = [...currentCerts, certificateId];
            const guard = nextDailyGuard(data.dailyGuard, 0);
            tx.update(userRef, {
                certificates: newCerts,
                dailyGuard: guard,
                lastTransaction: { type: 'collectible_award', taskId, at: Date.now() }
            });
            return { alreadyOwned: false, certificates: newCerts, guard };
        }));
        if (result.alreadyOwned) return { ok: true, alreadyOwned: true };
        return { ok: true, certificates: result.certificates, guard: result.guard };
    } catch (err) {
        return friendlyError(err);
    }
}
