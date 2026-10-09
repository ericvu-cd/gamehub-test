import { db } from './firebase-config.js';
import { doc, collection, runTransaction, getDoc } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';

// 售價與適用任務須同步 firestore.rules；商品文案、圖片仍由 GitHub 管理。
export const TICKET_DEFINITIONS = {
    fishball_revive: { taskId: 'fishball', cost: 300 }
};

export function ticketGuard(previous, delta) {
    const day = Math.floor((Date.now() + 28800000) / 86400000);
    const sameDay = previous?.day === day;
    return { day, netChange: (sameDay ? previous.netChange : 0) + delta,
        txCount: (sameDay ? previous.txCount : 0) + 1 };
}

function failure(err) {
    return { ok: false, uncertain: err?.code !== 'permission-denied',
        reason: err?.code === 'permission-denied'
            ? '交易被規則拒絕，請確認道具券規則已發布及每日交易額度。'
            : '尚未確認交易結果，請保持畫面並重試。' };
}

export async function buyItemTicket(uid, item) {
    const definition = TICKET_DEFINITIONS[item.id];
    if (!definition || item.cost !== definition.cost || item.taskId !== definition.taskId)
        return { ok: false, reason: '道具券設定與規則不一致，暫時無法購買。' };
    const userRef = doc(db, 'users', uid);
    const receiptRef = doc(collection(db, 'shopRedemptions', uid, 'entries'));
    const ledgerRef = doc(collection(db, 'coinLedger', uid, 'entries'));
    try {
        return await runTransaction(db, async tx => {
            const snapshot = await tx.get(userRef);
            const user = snapshot.data();
            if (!user) return { ok: false, reason: '找不到玩家資料。' };
            const tickets = user.itemTickets || [];
            if (tickets.includes(item.id)) return { ok: false, reason: '已持有此道具券，每種最多一張。' };
            if (user.coins < definition.cost) return { ok: false, reason: '金幣不足，需要 300 金幣。' };
            const at = Date.now(), coins = user.coins - definition.cost;
            const itemTickets = [...tickets, item.id];
            const dailyGuard = ticketGuard(user.dailyGuard, -definition.cost);
            tx.update(userRef, { coins, itemTickets, dailyGuard,
                lastTransaction: { type: 'item_ticket_purchase', itemId: item.id,
                    amount: definition.cost, requestId: receiptRef.id, at } });
            tx.set(receiptRef, { itemId: item.id, itemName: item.name, cost: definition.cost,
                type: 'item_ticket', redeemedAt: at });
            tx.set(ledgerRef, { type: 'shop_redemption', amount: -definition.cost,
                balanceAfter: coins, relatedTaskId: definition.taskId,
                note: `購買道具券：${item.name}`, createdAt: at });
            return { ok: true, newCoins: coins, itemTickets, guard: dailyGuard,
                redemption: { redeemedAt: at } };
        });
    } catch (err) { return failure(err); }
}

export async function useItemTicket(uid, taskId, itemId, requestId) {
    if (TICKET_DEFINITIONS[itemId]?.taskId !== taskId ||
        typeof requestId !== 'string' || !/^[A-Za-z0-9_-]{1,80}$/.test(requestId))
        return { ok: false, uncertain: false, reason: '道具券使用請求不正確。' };
    const userRef = doc(db, 'users', uid);
    const usageRef = doc(db, 'itemTicketUses', uid, 'entries', requestId);
    try {
        return await runTransaction(db, async tx => {
            const usage = await tx.get(usageRef);
            const snapshot = await tx.get(userRef);
            const user = snapshot.data();
            if (!user) return { ok: false, uncertain: false, reason: '找不到玩家資料。' };
            if (usage.exists()) {
                const saved = usage.data();
                if (saved.itemId !== itemId || saved.taskId !== taskId)
                    return { ok: false, uncertain: false, reason: '請求編號已被其他操作使用。' };
                return { ok: true, alreadyUsed: true, itemTickets: user.itemTickets || [], guard: user.dailyGuard };
            }
            if (!(user.itemTickets || []).includes(itemId))
                return { ok: false, uncertain: false, reason: '目前沒有這張道具券。', itemTickets: user.itemTickets || [] };
            const itemTickets = user.itemTickets.filter(id => id !== itemId);
            const at = Date.now(), dailyGuard = ticketGuard(user.dailyGuard, 0);
            tx.update(userRef, { itemTickets, dailyGuard,
                lastTransaction: { type: 'item_ticket_use', itemId, taskId, requestId, at } });
            tx.set(usageRef, { itemId, taskId, requestId, usedAt: at });
            return { ok: true, itemTickets, guard: dailyGuard };
        });
    } catch (err) {
        // 同編號並行請求可能在第一筆提交後被規則拒絕；查核已提交紀錄再判斷結果。
        try {
            const [usage, snapshot] = await Promise.all([getDoc(usageRef), getDoc(userRef)]);
            if (usage.exists() && usage.data().itemId === itemId && usage.data().taskId === taskId && snapshot.exists()) {
                const user = snapshot.data();
                return { ok: true, alreadyUsed: true, itemTickets: user.itemTickets || [], guard: user.dailyGuard };
            }
            return failure(err);
        } catch {
            return { ok: false, uncertain: true, reason: '尚未確認道具券是否已使用，請保持畫面並重試確認。' };
        }
    }
}
