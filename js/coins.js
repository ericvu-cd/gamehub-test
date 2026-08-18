// =====================================================
// 通行金幣異動邏輯
// ⚠️ 這裡每個函式的寫入方式，都必須跟 firestore.rules 裡對應的
// isDailyLoginClaim / isTaskCostDeduction / isTaskRewardClaim /
// isCollectibleClaim 邏輯完全一致，改這裡的欄位寫法時，
// 請同步檢查 firestore.rules 是否也要跟著調整。
// 對應功能規格書 6.2、8.1 節。
// =====================================================
import { db } from './firebase-config.js';
import {
    doc, writeBatch, collection, getDoc, increment
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

function utc8DayNumber(date = new Date()) {
    return Math.floor((date.getTime() + 8 * 60 * 60 * 1000) / (24 * 60 * 60 * 1000));
}

function friendlyError(err) {
    if (err?.code === 'permission-denied') {
        return { ok: false, reason: '這個操作不符合條件（可能已經領過、金額對不上，或已達每日上限）' };
    }
    return { ok: false, reason: err?.message || '發生未知錯誤' };
}

// --- 每日登入獎勵 ---
export async function claimDailyLogin(uid, currentCoins) {
    const today = utc8DayNumber();
    const batch = writeBatch(db);
    const userRef = doc(db, 'users', uid);
    const newCoins = currentCoins + 10;

    batch.update(userRef, {
        lastDailyLoginDay: today,
        coins: newCoins,
        lastTransaction: { type: 'daily_login', amount: 10, taskId: null, at: Date.now() }
    });

    const ledgerRef = doc(collection(db, 'coinLedger', uid, 'entries'));
    batch.set(ledgerRef, {
        type: 'daily_login', amount: 10, balanceAfter: newCoins,
        relatedTaskId: null, note: '', createdAt: Date.now()
    });

    try {
        await batch.commit();
        return { ok: true, newCoins };
    } catch (err) {
        return friendlyError(err);
    }
}

// --- 進入任務扣款 ---
export async function deductTaskCost(uid, taskId, currentCoins) {
    const taskSnap = await getDoc(doc(db, 'tasks', taskId));
    if (!taskSnap.exists()) return { ok: false, reason: '找不到此任務' };
    const cost = taskSnap.data().entryCost || 0;

    if (cost <= 0) return { ok: true, newCoins: currentCoins, cost: 0 }; // 免費任務，不需扣款

    if (currentCoins < cost) return { ok: false, reason: `通行金幣不足，需要 ${cost} 枚` };

    const newCoins = currentCoins - cost;
    const batch = writeBatch(db);
    const userRef = doc(db, 'users', uid);

    batch.update(userRef, {
        coins: newCoins,
        lastTransaction: { type: 'task_cost', amount: cost, taskId, at: Date.now() }
    });

    const ledgerRef = doc(collection(db, 'coinLedger', uid, 'entries'));
    batch.set(ledgerRef, {
        type: 'task_cost', amount: -cost, balanceAfter: newCoins,
        relatedTaskId: taskId, note: '', createdAt: Date.now()
    });

    try {
        await batch.commit();
        return { ok: true, newCoins, cost };
    } catch (err) {
        return friendlyError(err);
    }
}

// --- 任務獎勵（受每日獎勵上限限制）---
export async function claimTaskReward(uid, taskId, requestedAmount, currentCoins) {
    if (!requestedAmount || requestedAmount <= 0) return { ok: true, coinsAwarded: 0 };

    const taskSnap = await getDoc(doc(db, 'tasks', taskId));
    if (!taskSnap.exists()) return { ok: false, reason: '找不到此任務' };
    const cap = taskSnap.data().dailyRewardCap || 0;

    const today = utc8DayNumber();
    const trackingId = `${taskId}_${today}`;
    const trackingRef = doc(db, 'users', uid, 'taskRewardTracking', trackingId);
    const trackingSnap = await getDoc(trackingRef);
    const alreadyRewarded = trackingSnap.exists() ? (trackingSnap.data().totalRewarded || 0) : 0;

    const remaining = Math.max(0, cap - alreadyRewarded);
    const amount = Math.min(requestedAmount, remaining);

    if (amount <= 0) {
        return { ok: false, reason: '今日此任務的獎勵已達上限', coinsAwarded: 0 };
    }

    const newCoins = currentCoins + amount;
    const newTotal = alreadyRewarded + amount;

    const batch = writeBatch(db);
    const userRef = doc(db, 'users', uid);

    batch.update(userRef, {
        coins: newCoins,
        lastTransaction: { type: 'task_reward', amount, taskId, at: Date.now() }
    });

    batch.set(trackingRef, { taskId, day: today, totalRewarded: newTotal });

    const ledgerRef = doc(collection(db, 'coinLedger', uid, 'entries'));
    batch.set(ledgerRef, {
        type: 'task_reward', amount, balanceAfter: newCoins,
        relatedTaskId: taskId, note: '', createdAt: Date.now()
    });

    try {
        await batch.commit();
        return { ok: true, coinsAwarded: amount, newCoins, cappedFromRequested: amount < requestedAmount };
    } catch (err) {
        return friendlyError(err);
    }
}

// --- 授予徽章 ---
export async function awardBadge(uid, taskId, badgeId, currentBadges) {
    if (currentBadges.includes(badgeId)) return { ok: true, alreadyOwned: true };

    const badgeSnap = await getDoc(doc(db, 'badges', badgeId));
    if (!badgeSnap.exists() || badgeSnap.data().sourceTaskId !== taskId) {
        return { ok: false, reason: '此徽章不屬於這個任務' };
    }

    const newBadges = [...currentBadges, badgeId];
    try {
        await writeBatch(db).update(doc(db, 'users', uid), {
            badges: newBadges,
            lastTransaction: { type: 'collectible_award', taskId, at: Date.now() }
        }).commit();
        return { ok: true, badges: newBadges };
    } catch (err) {
        return friendlyError(err);
    }
}

// --- 授予證書 ---
export async function awardCertificate(uid, taskId, certificateId, currentCertificates) {
    if (currentCertificates.includes(certificateId)) return { ok: true, alreadyOwned: true };

    const certSnap = await getDoc(doc(db, 'certificates', certificateId));
    if (!certSnap.exists() || certSnap.data().sourceTaskId !== taskId) {
        return { ok: false, reason: '此證書不屬於這個任務' };
    }

    const newCerts = [...currentCertificates, certificateId];
    try {
        await writeBatch(db).update(doc(db, 'users', uid), {
            certificates: newCerts,
            lastTransaction: { type: 'collectible_award', taskId, at: Date.now() }
        }).commit();
        return { ok: true, certificates: newCerts };
    } catch (err) {
        return friendlyError(err);
    }
}
