import { db } from './firebase-config.js';
import { doc, collection, runTransaction, serverTimestamp, getDocFromServer, getDocsFromServer } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';
import { loadShopItems } from './content.js';
import { ticketGuard } from './itemTickets.js';

export function expiryMillis(value) {
    if (!value) return null;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error('有效期限格式不正確。');
    const result = Date.parse(`${value}T00:00:00+08:00`);
    if (!Number.isFinite(result) || new Date(result + 28800000).toISOString().slice(0, 10) !== value)
        throw new Error('有效期限不存在。');
    return result + 86400000;
}

export async function generateCouponCode(uid) {
    const random = crypto.getRandomValues(new Uint8Array(32));
    const hex = bytes => Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
    const input = `${hex(random)}:${Date.now()}:${hex(new TextEncoder().encode(uid))}`;
    const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input)));
    return BigInt(`0x${hex(digest)}`).toString(36).toUpperCase().padStart(50, '0').slice(-12);
}

const receipt = (uid, id) => doc(db, 'shopRedemptions', uid, 'entries', id);
const offline = () => typeof navigator !== 'undefined' && navigator.onLine === false;
const record = snap => ({ id: snap.id, ...snap.data() });
export async function listMerchantCoupons(uid) {
    const snapshots = await getDocsFromServer(collection(db, 'shopRedemptions', uid, 'entries'));
    return snapshots.docs.map(record).filter(row => row.type === 'merchant_coupon')
        .sort((a, b) => b.redeemedAt - a.redeemedAt);
}
export async function readMerchantCoupon(uid, id) {
    const snap = await getDocFromServer(receipt(uid, id));
    if (!snap.exists() || snap.data().type !== 'merchant_coupon') throw new Error('找不到這張券。');
    return record(snap);
}

export async function buyMerchantCoupon(uid, item) {
    if (offline()) return { ok: false, reason: '請連線後再兌換。' };
    try {
        const definition = (await loadShopItems()).find(row => row.id === item.id);
        if (!definition || definition.type === 'item_ticket' || definition.isActive === false ||
            !Number.isInteger(definition.cost) || definition.cost < 1 || definition.cost > 300 ||
            definition.cost !== item.cost || (definition.validUntil || '') !== (item.validUntil || ''))
            throw new Error('商品已更新或下架，請重新整理商城。');
        const expiresAt = expiryMillis(definition.validUntil);
        const ref = doc(collection(db, 'shopRedemptions', uid, 'entries'));
        const ledger = doc(collection(db, 'coinLedger', uid, 'entries'));
        const userRef = doc(db, 'users', uid);
        const couponCode = await generateCouponCode(uid);
        return await runTransaction(db, async tx => {
            const snap = await tx.get(userRef), user = snap.data();
            if (!user) throw new Error('找不到玩家資料。');
            if (user.coins < definition.cost) throw new Error('金幣不足。');
            if (expiresAt !== null && Date.now() >= expiresAt) throw new Error('商品已超過有效期限。');
            const at = Date.now(), coins = user.coins - definition.cost;
            const guard = ticketGuard(user.dailyGuard, -definition.cost);
            tx.update(userRef, { coins, dailyGuard: guard,
                lastTransaction: { type: 'merchant_purchase', amount: definition.cost,
                    itemId: definition.id, requestId: ref.id, at } });
            tx.set(ref, { type: 'merchant_coupon', itemId: definition.id, itemName: definition.name,
                description: definition.description || '', iconUrl: definition.iconUrl || '',
                cost: definition.cost, couponCode, redeemedAt: at, issuedAt: serverTimestamp(),
                validUntil: definition.validUntil || '', expiresAt, status: 'available', usedAt: null });
            tx.set(ledger, { type: 'shop_redemption', amount: -definition.cost, balanceAfter: coins,
                relatedTaskId: null, note: `商店兌換：${definition.name}`, createdAt: at });
            return { ok: true, newCoins: coins, guard, redemption: { id: ref.id } };
        });
    } catch (err) { return { ok: false, reason: err.message || '兌換未完成，請稍後重試。' }; }
}

export async function useMerchantCoupon(uid, id) {
    if (offline()) return { ok: false, reason: '請連線後再使用，尚未核銷。' };
    try {
        const ref = receipt(uid, id);
        const result = await runTransaction(db, async tx => {
            const snap = await tx.get(ref), coupon = snap.data();
            if (!coupon || coupon.type !== 'merchant_coupon') throw new Error('找不到這張券。');
            if (coupon.status !== 'available') return { alreadyUsed: true };
            if (coupon.expiresAt !== null && Date.now() >= coupon.expiresAt) throw new Error('此券已過期。');
            tx.update(ref, { status: 'used', usedAt: serverTimestamp() });
            return { alreadyUsed: false };
        });
        return { ok: true, ...result, coupon: await readMerchantCoupon(uid, id) };
    } catch (err) {
        // The write may have committed before a network failure; refresh from server before retrying.
        try {
            const coupon = await readMerchantCoupon(uid, id);
            if (coupon.status === 'used') return { ok: true, alreadyUsed: true, coupon };
            if (coupon.expiresAt !== null && Date.now() >= coupon.expiresAt)
                return { ok: false, uncertain: false, reason: '此券已過期，無法使用。' };
        } catch { /* Remain uncertain when the server cannot be reached. */ }
        return { ok: false, uncertain: true, reason: '尚未確認使用結果，請連線後重新查看此券狀態。' };
    }
}
