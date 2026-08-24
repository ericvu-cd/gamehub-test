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

// --- 任務縮圖：直接讀取任務自己 HTML 裡 <link rel="icon"> 設定的圖示 ---
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
    const banners = await fetchJson('./data/banners.json');
    const now = nowMs();
    return banners
        .filter(b => b.isActive !== false)
        .filter(b => (!b.startAt || b.startAt <= now) && (!b.endAt || b.endAt >= now))
        .sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0));
}

export async function loadTasks() {
    const allTasks = await fetchJson('./data/tasks.json');
    const tasks = allTasks
        .filter(t => t.isActive !== false)
        .sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0));

    // 平行抓取每個任務頁面的 icon 設定，不逐一等待，加快整體載入速度
    await Promise.all(tasks.map(async (t) => {
        t.iconUrl = await resolveTaskIcon(t.link);
    }));

    return tasks;
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
