// =====================================================
// 內容資料層：Banner／任務／公告／徽章／證書／頭像清單
// 全部改放 GitHub 的 /data/*.json，前端直接 fetch 讀取，
// 不佔用 Firestore 讀取額度。管理後台改用 GitHub API 寫回這些檔案。
// =====================================================

function nowMs() { return Date.now(); }

async function fetchJson(path) {
    const res = await fetch(path, { cache: 'no-store' });
    if (!res.ok) throw new Error(`讀取 ${path} 失敗（HTTP ${res.status}）`);
    return res.json();
}

// 取得目前有效的 Banner（在上下架時間區間內），依 sortOrder 排序
export async function loadActiveBanners() {
    const banners = await fetchJson('./data/banners.json');
    const now = nowMs();
    return banners
        .filter(b => b.isActive !== false)
        .filter(b => (!b.startAt || b.startAt <= now) && (!b.endAt || b.endAt >= now))
        .sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0));
}

// 任務橫幅圖改由後台直接上傳（bannerUrl 欄位），不再自動讀取任務網址的 favicon
export async function loadTasks() {
    const allTasks = await fetchJson('./data/tasks.json');
    return allTasks
        .filter(t => t.isActive !== false)
        .sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0));
}

// 公告：依公告期篩選 + 依日期新到舊排序
export async function loadNews() {
    const news = await fetchJson('./data/news.json');
    const now = nowMs();
    return news
        .filter(n => (!n.startAt || n.startAt <= now) && (!n.endAt || n.endAt >= now))
        .sort((a, b) => (b.publishedAt || 0) - (a.publishedAt || 0));
}

export async function loadBadges() {
    return fetchJson('./data/badges.json');
}

export async function loadCertificates() {
    return fetchJson('./data/certificates.json');
}

export async function loadAvatarPresets() {
    return fetchJson('./data/avatarPresets.json');
}

// 商店品項：跟任務清單一樣的慣例（isActive 篩選、sortOrder 排序）
export async function loadShopItems() {
    const items = await fetchJson('./data/shopItems.json');
    return items
        .filter(i => i.isActive !== false)
        .sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0));
}
