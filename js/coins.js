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
import { doc, writeBatch, collection, increment } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

function utc8DayNumber(date = new Date()) {
    return Math.floor((date.getTime() + 8 * 60 * 60 * 1000) / (24 * 60 * 60 * 1000));
}

function friendlyError(err) {
    if (err?.code === 'permission-denied') {
        return { ok: false, reason: '今天的異動次數或金額已達上限，請明天再試' };
    }
    return { ok: false, reason: err?.message || '發生未知錯誤' };
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
export async function claimDailyLogin(uid, currentCoins, currentGuard) {
    const today = utc8DayNumber();
    const newCoins = currentCoins + 10;
    const guard = nextDailyGuard(currentGuard, 10);

    const batch = writeBatch(db);
    const userRef = doc(db, 'users', uid);
    batch.update(userRef, {
        lastDailyLoginDay: today,
        coins: newCoins,
        dailyGuard: guard,
        lastTransaction: { type: 'daily_login', amount: 10, taskId: null, at: Date.now() }
    });

    const ledgerRef = doc(collection(db, 'coinLedger', uid, 'entries'));
    batch.set(ledgerRef, {
        type: 'daily_login', amount: 10, balanceAfter: newCoins,
        relatedTaskId: null, note: '', createdAt: Date.now()
    });

    try {
        await batch.commit();
        return { ok: true, newCoins, guard };
    } catch (err) {
        return friendlyError(err);
    }
}

// --- 進入任務扣款（task 為 content.js 讀回的任務物件，含 entryCost） ---
export async function deductTaskCost(uid, task, currentCoins, currentGuard) {
    const cost = task.entryCost || 0;
    if (cost <= 0) return { ok: true, newCoins: currentCoins, cost: 0 };
    if (currentCoins < cost) return { ok: false, reason: `通行金幣不足，需要 ${cost} 枚` };

    const newCoins = currentCoins - cost;
    const guard = nextDailyGuard(currentGuard, -cost);

    const batch = writeBatch(db);
    const userRef = doc(db, 'users', uid);
    batch.update(userRef, {
        coins: newCoins,
        dailyGuard: guard,
        lastTransaction: { type: 'task_cost', amount: cost, taskId: task.id, at: Date.now() }
    });

    const ledgerRef = doc(collection(db, 'coinLedger', uid, 'entries'));
    batch.set(ledgerRef, {
        type: 'task_cost', amount: -cost, balanceAfter: newCoins,
        relatedTaskId: task.id, note: '', createdAt: Date.now()
    });

    try {
        await batch.commit();
        return { ok: true, newCoins, cost, guard };
    } catch (err) {
        return friendlyError(err);
    }
}

// --- 任務獎勵（不再核對任務個別上限，改受當日總量防護限制） ---
export async function claimTaskReward(uid, taskId, requestedAmount, currentCoins, currentGuard) {
    if (!requestedAmount || requestedAmount <= 0) return { ok: true, coinsAwarded: 0 };

    const newCoins = currentCoins + requestedAmount;
    const guard = nextDailyGuard(currentGuard, requestedAmount);

    const batch = writeBatch(db);
    const userRef = doc(db, 'users', uid);
    batch.update(userRef, {
        coins: newCoins,
        dailyGuard: guard,
        lastTransaction: { type: 'task_reward', amount: requestedAmount, taskId, at: Date.now() }
    });

    const ledgerRef = doc(collection(db, 'coinLedger', uid, 'entries'));
    batch.set(ledgerRef, {
        type: 'task_reward', amount: requestedAmount, balanceAfter: newCoins,
        relatedTaskId: taskId, note: '', createdAt: Date.now()
    });

    try {
        await batch.commit();
        return { ok: true, coinsAwarded: requestedAmount, newCoins, guard };
    } catch (err) {
        return friendlyError(err);
    }
}

// --- 授予徽章（不再核對來源任務，見架構調整討論記錄第三輪確認） ---
export async function awardBadge(uid, taskId, badgeId, currentBadges, currentGuard) {
    if (currentBadges.includes(badgeId)) return { ok: true, alreadyOwned: true };
    const newBadges = [...currentBadges, badgeId];
    const guard = nextDailyGuard(currentGuard, 0);

    try {
        await writeBatch(db).update(doc(db, 'users', uid), {
            badges: newBadges,
            dailyGuard: guard,
            lastTransaction: { type: 'collectible_award', taskId, at: Date.now() }
        }).commit();
        return { ok: true, badges: newBadges, guard };
    } catch (err) {
        return friendlyError(err);
    }
}

// --- 授予證書（同上，不核對來源任務） ---
export async function awardCertificate(uid, taskId, certificateId, currentCertificates, currentGuard) {
    if (currentCertificates.includes(certificateId)) return { ok: true, alreadyOwned: true };
    const newCerts = [...currentCertificates, certificateId];
    const guard = nextDailyGuard(currentGuard, 0);

    try {
        await writeBatch(db).update(doc(db, 'users', uid), {
            certificates: newCerts,
            dailyGuard: guard,
            lastTransaction: { type: 'collectible_award', taskId, at: Date.now() }
        }).commit();
        return { ok: true, certificates: newCerts, guard };
    } catch (err) {
        return friendlyError(err);
    }
}
