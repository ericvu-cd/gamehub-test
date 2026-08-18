// =====================================================
// 內容資料層：Banner／任務／公告／徽章／證書／頭像清單
// 全部存在 Firestore，由管理後台維護（見規格書 6.4 節）
// =====================================================
import { db } from './firebase-config.js';
import {
    collection, getDocs, query, where, orderBy
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

function nowMs() { return Date.now(); }

// 取得目前有效的 Banner（在上下架時間區間內），依 sortOrder 排序
export async function loadActiveBanners() {
    const snap = await getDocs(query(collection(db, 'banners'), orderBy('sortOrder', 'asc')));
    const now = nowMs();
    return snap.docs
        .map(d => ({ id: d.id, ...d.data() }))
        .filter(b => b.isActive !== false)
        .filter(b => (!b.startAt || b.startAt <= now) && (!b.endAt || b.endAt >= now));
}

export async function loadTasks() {
    const snap = await getDocs(query(
        collection(db, 'tasks'),
        where('isActive', '==', true),
        orderBy('sortOrder', 'asc')
    ));
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

// 公告：依公告期篩選 + 依日期新到舊排序（見規格書 6.7 節）
export async function loadNews() {
    const snap = await getDocs(query(collection(db, 'news'), orderBy('publishedAt', 'desc')));
    const now = nowMs();
    return snap.docs
        .map(d => ({ id: d.id, ...d.data() }))
        .filter(n => (!n.startAt || n.startAt <= now) && (!n.endAt || n.endAt >= now));
}

export async function loadBadges() {
    const snap = await getDocs(collection(db, 'badges'));
    const map = {};
    snap.docs.forEach(d => { map[d.id] = d.data(); });
    return map;
}

export async function loadCertificates() {
    const snap = await getDocs(collection(db, 'certificates'));
    const map = {};
    snap.docs.forEach(d => { map[d.id] = d.data(); });
    return map;
}

export async function loadAvatarPresets() {
    const snap = await getDocs(collection(db, 'avatarPresets'));
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}
