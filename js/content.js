// =====================================================
// 內容資料層：Banner／任務／公告／徽章／證書／頭像清單
// 全部存在 Firestore，由管理後台維護（見規格書 6.4 節）
// =====================================================
import { db } from './firebase-config.js';
import {
    collection, getDocs, query, where, orderBy
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

function nowMs() { return Date.now(); }

// --- 任務縮圖：直接讀取任務自己 HTML 裡 <link rel="icon"> 設定的圖示，
//     不再由後台手動指定圖片連結。任務開發者只要在自己的 HTML <head> 加：
//       <link rel="icon" href="icon.png">
//     （或任何合法的 icon 圖片路徑／data URI）即可，平台會自動抓取顯示。
const taskIconCache = new Map();

async function resolveTaskIcon(taskUrl) {
    if (!taskUrl) return null;
    const absoluteUrl = new URL(taskUrl, location.href).href;
    if (taskIconCache.has(absoluteUrl)) return taskIconCache.get(absoluteUrl);

    try {
        const res = await fetch(absoluteUrl, { cache: 'force-cache' });
        if (!res.ok) throw new Error('無法讀取任務頁面');
        const html = await res.text();
        const doc = new DOMParser().parseFromString(html, 'text/html');
        const linkEl = doc.querySelector('link[rel~="icon"]');
        const href = linkEl?.getAttribute('href');
        const iconUrl = href ? new URL(href, absoluteUrl).href : null;
        taskIconCache.set(absoluteUrl, iconUrl);
        return iconUrl;
    } catch (err) {
        console.warn(`讀取任務縮圖失敗（${absoluteUrl}）：`, err.message);
        taskIconCache.set(absoluteUrl, null);
        return null;
    }
}

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
    const tasks = snap.docs.map(d => ({ id: d.id, ...d.data() }));

    // 平行抓取每個任務頁面的 icon 設定，不逐一等待，加快整體載入速度
    await Promise.all(tasks.map(async (t) => {
        t.iconUrl = await resolveTaskIcon(t.link);
    }));

    return tasks;
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
