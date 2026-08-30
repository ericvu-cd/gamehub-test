// =====================================================
// 管理後台程式邏輯（GitHub 遷移版）
// 內容資料（Banner/任務/公告/徽章/證書）改用 GitHub Contents API 讀寫，
// 圖片直接上傳進 repo（無壓縮，見架構調整討論記錄第三輪確認）。
// 使用者資料編修維持走 Firestore + Google 登入，不變。
// =====================================================
import { auth, db } from '../js/firebase-config.js';
import {
    GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
    doc, getDoc, updateDoc, collection, getDocs
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { resolveTaskIcon } from '../js/content.js';

/* =====================================================
   GitHub Contents API 連線層
===================================================== */
const GH_CONFIG_KEY = 'gh_admin_config';

function getGhConfig() {
    try { return JSON.parse(localStorage.getItem(GH_CONFIG_KEY) || 'null'); }
    catch { return null; }
}
function setGhConfig(cfg) { localStorage.setItem(GH_CONFIG_KEY, JSON.stringify(cfg)); }
function clearGhConfig() { localStorage.removeItem(GH_CONFIG_KEY); }

async function ghRequest(path, options = {}) {
    const cfg = getGhConfig();
    if (!cfg) throw new Error('尚未設定 GitHub 連線資訊');
    const url = `https://api.github.com/repos/${cfg.owner}/${cfg.repo}/contents/${path}`;
    const res = await fetch(url, {
        ...options,
        headers: {
            'Authorization': `Bearer ${cfg.token}`,
            'Accept': 'application/vnd.github+json',
            ...(options.headers || {})
        }
    });
    if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        const err = new Error(`GitHub API 錯誤（${res.status}）：${body.message || res.statusText}`);
        err.status = res.status;
        throw err;
    }
    return res.status === 204 ? null : res.json();
}

function utf8ToBase64(str) {
    return btoa(unescape(encodeURIComponent(str)));
}
function base64ToUtf8(b64) {
    return decodeURIComponent(escape(atob(b64.replace(/\n/g, ''))));
}

// 讀取一份 JSON 檔案，回傳 { data, sha }；檔案不存在時回傳 { data: fallback, sha: null }
async function readJsonFile(path, fallback) {
    try {
        const res = await ghRequest(path);
        return { data: JSON.parse(base64ToUtf8(res.content)), sha: res.sha };
    } catch (err) {
        if (err.status === 404) return { data: fallback, sha: null };
        throw err;
    }
}

// 寫回一份 JSON 檔案（新增或更新皆可，sha 為 null 代表新建檔案）
async function writeJsonFile(path, jsonData, sha, message) {
    const cfg = getGhConfig();
    const body = {
        message: message || `更新 ${path}`,
        content: utf8ToBase64(JSON.stringify(jsonData, null, 2)),
        branch: cfg.branch || 'main'
    };
    if (sha) body.sha = sha;
    return ghRequest(path, { method: 'PUT', body: JSON.stringify(body) });
}

// 上傳圖片檔案，回傳可直接使用的圖片網址（raw.githubusercontent.com）
async function uploadImageToGithub(file, folder) {
    const cfg = getGhConfig();
    const buf = await file.arrayBuffer();
    const bytes = new Uint8Array(buf);
    let binary = '';
    for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
    const base64 = btoa(binary);
    const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
    const path = `data/images/${folder}/${Date.now()}_${safeName}`;

    await ghRequest(path, {
        method: 'PUT',
        body: JSON.stringify({
            message: `上傳圖片 ${safeName}`,
            content: base64,
            branch: cfg.branch || 'main'
        })
    });
    return `https://raw.githubusercontent.com/${cfg.owner}/${cfg.repo}/${cfg.branch || 'main'}/${path}`;
}

/* =====================================================
   GitHub 連線設定畫面
===================================================== */
window.toggleGhTokenVisibility = function (event) {
    const input = document.getElementById('gh-token');
    const btn = event.currentTarget;
    const isMasked = input.classList.contains('masked');
    if (isMasked) { input.classList.remove('masked'); btn.innerText = '隱藏'; }
    else { input.classList.add('masked'); btn.innerText = '顯示'; }
};

window.saveGhSetup = async function () {
    const owner = document.getElementById('gh-owner').value.trim();
    const repo = document.getElementById('gh-repo').value.trim();
    const branch = document.getElementById('gh-branch').value.trim() || 'main';
    const token = document.getElementById('gh-token').value.trim();
    const errorEl = document.getElementById('gh-setup-error');
    errorEl.classList.add('hidden');

    if (!owner || !repo || !token) {
        errorEl.innerText = '請填寫完整資訊';
        errorEl.classList.remove('hidden');
        return;
    }

    setGhConfig({ owner, repo, branch, token });

    try {
        // 測試連線：嘗試讀取 repo 根目錄
        await ghRequest('');
        showGhApp();
    } catch (err) {
        clearGhConfig();
        errorEl.innerText = '連線失敗：' + err.message;
        errorEl.classList.remove('hidden');
    }
};

window.disconnectGh = function () {
    if (!confirm('確定要中斷 GitHub 連線嗎？權杖只會從這台瀏覽器移除，不影響 GitHub 上的設定。')) return;
    clearGhConfig();
    location.reload();
};

function showGhApp() {
    const cfg = getGhConfig();
    document.getElementById('gh-setup-screen').classList.add('hidden');
    document.getElementById('gh-app').classList.remove('hidden');
    document.getElementById('gh-status-text').innerText = `${cfg.owner}/${cfg.repo}（${cfg.branch}）`;
    document.getElementById('gh-repo-label').innerText = `${cfg.owner}/${cfg.repo}`;
    loadAllContentLists();
}

/* =====================================================
   分頁切換
===================================================== */
window.switchAdminTab = function (tabName) {
    document.querySelectorAll('nav.tabs button').forEach(b => b.classList.toggle('active', b.dataset.tab === tabName));
    document.querySelectorAll('section.panel').forEach(p => p.classList.toggle('active', p.id === `panel-${tabName}`));
};

/* =====================================================
   圖片上傳（表單用，選檔後先預覽，送出時才真的上傳）
===================================================== */
const editState = {
    banners: { editingId: null, pendingFile: null, sha: null, items: [] },
    tasks: { editingId: null, pendingFile: null, sha: null, items: [] },
    news: { editingId: null, pendingFile: null, sha: null, items: [] },
    badges: { editingId: null, pendingFile: null, sha: null, items: {} },
    certificates: { editingId: null, pendingFile: null, sha: null, items: {} }
};

function showMsg(panelKey, text, isError = false) {
    const el = document.getElementById(`${panelKey}-msg`);
    el.innerHTML = `<div class="msg ${isError ? 'err' : 'ok'}">${text}</div>`;
    setTimeout(() => { el.innerHTML = ''; }, 4000);
}

function dateToMs(dateStr) { return dateStr ? new Date(dateStr + 'T00:00:00').getTime() : null; }
function msToDateValue(ms) { return ms ? new Date(ms).toISOString().slice(0, 10) : ''; }

window.handleImageSelect = function (event, entityKey) {
    const file = event.target.files[0];
    if (!file) return;
    editState[entityKey].pendingFile = file;
    const reader = new FileReader();
    reader.onload = (e) => {
        const img = document.getElementById(`${entityKey}-image-preview`);
        img.src = e.target.result;
        img.style.display = 'block';
        document.getElementById(`${entityKey}-image-placeholder`).classList.add('hidden');
    };
    reader.readAsDataURL(file);
};

async function uploadPendingImage(entityKey, existingUrl) {
    const pending = editState[entityKey].pendingFile;
    if (!pending) return existingUrl || null;
    const progressEl = document.getElementById(`${entityKey}-upload-progress`);
    progressEl.innerText = '圖片上傳中（正在寫入 GitHub）...';
    try {
        const url = await uploadImageToGithub(pending, entityKey);
        progressEl.innerText = '✓ 圖片上傳完成';
        setTimeout(() => { progressEl.innerText = ''; }, 2500);
        return url;
    } catch (err) {
        progressEl.innerText = '❌ 圖片上傳失敗：' + err.message;
        throw err;
    }
}

function resetImagePreview(entityKey) {
    const img = document.getElementById(`${entityKey}-image-preview`);
    if (!img) return;
    img.src = ''; img.style.display = 'none';
    document.getElementById(`${entityKey}-image-placeholder`).classList.remove('hidden');
    editState[entityKey].pendingFile = null;
    const fileInput = document.querySelector(`#${entityKey}-form input[type=file]`);
    if (fileInput) fileInput.value = '';
}

function showExistingImage(entityKey, url) {
    const img = document.getElementById(`${entityKey}-image-preview`);
    if (!img) return;
    const placeholder = document.getElementById(`${entityKey}-image-placeholder`);
    if (url) { img.src = url; img.style.display = 'block'; placeholder.classList.add('hidden'); }
    else { img.src = ''; img.style.display = 'none'; placeholder.classList.remove('hidden'); }
}

/* =====================================================
   編輯模式共用邏輯
===================================================== */
function enterEditMode(entityKey, idFieldEditable) {
    document.getElementById(`${entityKey}-form-badge`).innerText = '編輯模式';
    document.getElementById(`${entityKey}-form-badge`).classList.replace('new', 'edit');
    document.getElementById(`${entityKey}-save-btn`).innerText = '更新';
    document.getElementById(`${entityKey}-cancel-btn`).classList.remove('hidden');
    const idInput = document.getElementById(`${entityKey}-id`);
    if (idInput && !idFieldEditable) idInput.disabled = true;
}

window.cancelEdit = function (entityKey) {
    editState[entityKey].editingId = null;
    editState[entityKey].pendingFile = null;
    document.getElementById(`${entityKey}-form`).reset();
    resetImagePreview(entityKey);
    document.getElementById(`${entityKey}-form-badge`).innerText = '新增模式';
    document.getElementById(`${entityKey}-form-badge`).classList.replace('edit', 'new');
    const saveLabels = { banners: '新增 Banner', tasks: '新增任務', news: '新增公告', badges: '新增徽章', certificates: '新增證書' };
    document.getElementById(`${entityKey}-save-btn`).innerText = saveLabels[entityKey];
    document.getElementById(`${entityKey}-cancel-btn`).classList.add('hidden');
    const idInput = document.getElementById(`${entityKey}-id`);
    if (idInput) idInput.disabled = false;
    if (entityKey === 'banners') window.onBannerActionTypeChange();
};

/* =====================================================
   Banner（data/banners.json，陣列）
===================================================== */
async function loadBannersList() {
    const { data, sha } = await readJsonFile('data/banners.json', []);
    editState.banners.items = data;
    editState.banners.sha = sha;
    renderBannersList();
}

function renderBannersList() {
    const wrap = document.getElementById('banners-list');
    const items = editState.banners.items;
    if (items.length === 0) { wrap.innerHTML = `<p class="empty-note">尚無資料</p>`; return; }
    wrap.innerHTML = items.map((b, i) => {
        const range = [b.startAt ? new Date(b.startAt).toLocaleDateString() : '無期限', b.endAt ? new Date(b.endAt).toLocaleDateString() : '無期限'].join(' ~ ');
        return `<div class="item-row ${b.isActive === false ? 'inactive' : ''}">
            ${b.imageUrl ? `<img class="item-thumb" src="${b.imageUrl}">` : `<div class="item-thumb"></div>`}
            <div class="item-info"><div class="item-title">${b.title}</div><div class="item-meta">${range} · ${b.isActive === false ? '已下架' : '上架中'}</div></div>
            <div class="item-actions">
                <button class="icon-btn edit" onclick="window.editBanner(${i})">編輯</button>
                <button class="icon-btn toggle" onclick="window.toggleBannerActive(${i})">${b.isActive === false ? '上架' : '下架'}</button>
                <button class="icon-btn danger" onclick="window.deleteBanner(${i})">刪除</button>
            </div>
        </div>`;
    }).join('');
}

window.onBannerActionTypeChange = function () {
    const type = document.getElementById('banners-actionType').value;
    document.getElementById('banners-actionValue-url-wrap').classList.toggle('hidden', type !== 'URL');
    document.getElementById('banners-actionValue-task-wrap').classList.toggle('hidden', type !== 'TASK');
};

window.editBanner = function (index) {
    const b = editState.banners.items[index];
    document.getElementById('banners-title').value = b.title || '';
    document.getElementById('banners-subtitle').value = b.subtitle || '';
    document.getElementById('banners-sortOrder').value = b.sortOrder || 0;
    document.getElementById('banners-startAt').value = msToDateValue(b.startAt);
    document.getElementById('banners-endAt').value = msToDateValue(b.endAt);
    document.getElementById('banners-actionType').value = b.actionType || 'NONE';
    document.getElementById('banners-actionValue-url').value = b.actionType === 'URL' ? (b.actionValue || '') : '';
    document.getElementById('banners-actionValue-task').value = b.actionType === 'TASK' ? (b.actionValue || '') : '';
    window.onBannerActionTypeChange();
    showExistingImage('banners', b.imageUrl);
    enterEditMode('banners', true);
    editState.banners.editingId = index;
    document.getElementById('panel-banners').scrollIntoView({ behavior: 'smooth' });
};

window.toggleBannerActive = async function (index) {
    editState.banners.items[index].isActive = editState.banners.items[index].isActive === false;
    await saveBannersFile('切換 Banner 上下架狀態');
};

window.deleteBanner = async function (index) {
    if (!confirm('確定要刪除嗎？此動作無法復原。')) return;
    editState.banners.items.splice(index, 1);
    await saveBannersFile('刪除 Banner');
};

async function saveBannersFile(message) {
    try {
        const result = await writeJsonFile('data/banners.json', editState.banners.items, editState.banners.sha, message);
        editState.banners.sha = result.content.sha;
        renderBannersList();
        showMsg('banners', '已儲存');
    } catch (err) {
        showMsg('banners', err.message, true);
        await loadBannersList(); // 版本可能衝突，重新讀取最新版本
    }
}

window.submitBanner = async function (e) {
    e.preventDefault();
    try {
        const editingIndex = editState.banners.editingId;
        const existing = editingIndex !== null ? editState.banners.items[editingIndex] : null;
        const imageUrl = await uploadPendingImage('banners', existing?.imageUrl);

        const actionType = document.getElementById('banners-actionType').value;
        const actionValue = actionType === 'URL' ? document.getElementById('banners-actionValue-url').value
            : actionType === 'TASK' ? document.getElementById('banners-actionValue-task').value : null;

        const data = {
            title: document.getElementById('banners-title').value,
            subtitle: document.getElementById('banners-subtitle').value || '',
            imageUrl,
            sortOrder: Number(document.getElementById('banners-sortOrder').value) || 0,
            startAt: dateToMs(document.getElementById('banners-startAt').value),
            endAt: dateToMs(document.getElementById('banners-endAt').value),
            actionType, actionValue,
            isActive: existing ? existing.isActive !== false : true
        };

        if (editingIndex !== null) {
            editState.banners.items[editingIndex] = { ...existing, ...data };
        } else {
            editState.banners.items.push({ id: 'banner_' + Date.now(), ...data });
        }

        await saveBannersFile(editingIndex !== null ? '更新 Banner' : '新增 Banner');
        window.cancelEdit('banners');
    } catch (err) { showMsg('banners', err.message, true); }
    return false;
};

/* =====================================================
   任務（data/tasks.json，陣列，id 為固定鍵值）
===================================================== */
async function loadTasksList() {
    const { data, sha } = await readJsonFile('data/tasks.json', []);
    editState.tasks.items = data;
    editState.tasks.sha = sha;
    renderTasksList();
}

function renderTasksList() {
    const wrap = document.getElementById('tasks-list');
    const items = editState.tasks.items;
    if (items.length === 0) { wrap.innerHTML = `<p class="empty-note">尚無資料</p>`; return; }
    wrap.innerHTML = items.map((t, i) => `<div class="item-row ${t.isActive === false ? 'inactive' : ''}">
        <div class="item-thumb" id="task-thumb-${i}"></div>
        <div class="item-info"><div class="item-title">${t.title} <span style="color:#999;font-weight:400;">(${t.id})</span></div>
            <div class="item-meta">扣 ${t.entryCost || 0} 金幣 · ${t.isActive === false ? '已下架' : '上架中'} · ${t.hasLeaderboard === false ? '無排行榜' : '有排行榜'}</div></div>
        <div class="item-actions">
            <button class="icon-btn edit" onclick="window.editTask(${i})">編輯</button>
            <button class="icon-btn toggle" onclick="window.toggleTaskActive(${i})">${t.isActive === false ? '上架' : '下架'}</button>
            <button class="icon-btn danger" onclick="window.deleteTask(${i})">刪除</button>
        </div>
    </div>`).join('');

    // 縮圖是去抓任務網址的 <link rel="icon">，需要非同步，不擋列表顯示，抓到後再各自補上
    items.forEach((t, i) => {
        if (!t.link) return;
        resolveTaskIcon(t.link).then(iconUrl => {
            if (!iconUrl) return;
            const el = document.getElementById(`task-thumb-${i}`);
            if (el) el.innerHTML = `<img src="${iconUrl}" style="width:100%;height:100%;object-fit:cover;border-radius:8px;">`;
        }).catch(() => { /* 抓不到就維持空白縮圖，不擋後台其他功能 */ });
    });
}

window.editTask = function (index) {
    const t = editState.tasks.items[index];
    document.getElementById('tasks-id').value = t.id;
    document.getElementById('tasks-title').value = t.title || '';
    document.getElementById('tasks-description').value = t.description || '';
    document.getElementById('tasks-colorTheme').value = t.colorTheme || 'mint';
    document.getElementById('tasks-sortOrder').value = t.sortOrder || 0;
    document.getElementById('tasks-link').value = t.link || '';
    document.getElementById('tasks-entryCost').value = t.entryCost || 0;
    document.getElementById('tasks-hasLeaderboard').checked = t.hasLeaderboard !== false;

    document.getElementById('tasks-unlockLevel').value = '';
    document.getElementById('tasks-unlockCoin').value = '';
    document.getElementById('tasks-unlockBadges').value = '';
    document.getElementById('tasks-unlockCerts').value = '';
    document.getElementById('tasks-unlockStart').value = '';
    document.getElementById('tasks-unlockEnd').value = '';
    for (const c of t.unlockConditions || []) {
        if (c.type === 'LEVEL') document.getElementById('tasks-unlockLevel').value = c.value;
        if (c.type === 'COIN') document.getElementById('tasks-unlockCoin').value = c.value;
        if (c.type === 'BADGE') document.getElementById('tasks-unlockBadges').value = (c.value || []).join(',');
        if (c.type === 'CERTIFICATE') document.getElementById('tasks-unlockCerts').value = (c.value || []).join(',');
        if (c.type === 'DATE') {
            document.getElementById('tasks-unlockStart').value = msToDateValue(c.startDate);
            document.getElementById('tasks-unlockEnd').value = msToDateValue(c.endDate);
        }
    }
    enterEditMode('tasks', false);
    editState.tasks.editingId = index;
    document.getElementById('panel-tasks').scrollIntoView({ behavior: 'smooth' });
};

window.toggleTaskActive = async function (index) {
    editState.tasks.items[index].isActive = editState.tasks.items[index].isActive === false;
    await saveTasksFile('切換任務上下架狀態');
};

window.deleteTask = async function (index) {
    if (!confirm('確定要刪除嗎？此動作無法復原。')) return;
    editState.tasks.items.splice(index, 1);
    await saveTasksFile('刪除任務');
};

async function saveTasksFile(message) {
    try {
        const result = await writeJsonFile('data/tasks.json', editState.tasks.items, editState.tasks.sha, message);
        editState.tasks.sha = result.content.sha;
        renderTasksList();
        showMsg('tasks', '已儲存');
    } catch (err) {
        showMsg('tasks', err.message, true);
        await loadTasksList();
    }
};

window.submitTask = async function (e) {
    e.preventDefault();
    const id = document.getElementById('tasks-id').value.trim();
    try {
        const editingIndex = editState.tasks.editingId;
        const existing = editingIndex !== null ? editState.tasks.items[editingIndex] : null;

        if (editingIndex === null && editState.tasks.items.some(t => t.id === id)) {
            showMsg('tasks', '此任務 ID 已存在，請換一個', true);
            return false;
        }

        const conditions = [];
        const lvl = document.getElementById('tasks-unlockLevel').value;
        const coin = document.getElementById('tasks-unlockCoin').value;
        const badgesStr = document.getElementById('tasks-unlockBadges').value;
        const certsStr = document.getElementById('tasks-unlockCerts').value;
        const startStr = document.getElementById('tasks-unlockStart').value;
        const endStr = document.getElementById('tasks-unlockEnd').value;
        if (lvl) conditions.push({ type: 'LEVEL', value: Number(lvl) });
        if (coin) conditions.push({ type: 'COIN', value: Number(coin) });
        if (badgesStr) conditions.push({ type: 'BADGE', value: badgesStr.split(',').map(s => s.trim()).filter(Boolean) });
        if (certsStr) conditions.push({ type: 'CERTIFICATE', value: certsStr.split(',').map(s => s.trim()).filter(Boolean) });
        if (startStr || endStr) conditions.push({ type: 'DATE', startDate: dateToMs(startStr) || 0, endDate: dateToMs(endStr) || 9999999999999 });

        const data = {
            id,
            title: document.getElementById('tasks-title').value,
            description: document.getElementById('tasks-description').value || '',
            colorTheme: document.getElementById('tasks-colorTheme').value,
            link: document.getElementById('tasks-link').value,
            entryCost: Number(document.getElementById('tasks-entryCost').value) || 0,
            unlockConditions: conditions,
            sortOrder: Number(document.getElementById('tasks-sortOrder').value) || 0,
            hasLeaderboard: document.getElementById('tasks-hasLeaderboard').checked,
            isActive: existing ? existing.isActive !== false : true
        };

        if (editingIndex !== null) {
            editState.tasks.items[editingIndex] = data;
        } else {
            editState.tasks.items.push(data);
        }

        await saveTasksFile(editingIndex !== null ? '更新任務' : '新增任務');
        window.cancelEdit('tasks');
    } catch (err) { showMsg('tasks', err.message, true); }
    return false;
};

/* =====================================================
   公告（data/news.json，陣列）
===================================================== */
async function loadNewsList() {
    const { data, sha } = await readJsonFile('data/news.json', []);
    editState.news.items = data;
    editState.news.sha = sha;
    renderNewsList();
}

function renderNewsList() {
    const wrap = document.getElementById('news-list');
    const items = editState.news.items;
    if (items.length === 0) { wrap.innerHTML = `<p class="empty-note">尚無資料</p>`; return; }
    wrap.innerHTML = items.map((n, i) => {
        const range = [n.startAt ? new Date(n.startAt).toLocaleDateString() : '無期限', n.endAt ? new Date(n.endAt).toLocaleDateString() : '無期限'].join(' ~ ');
        return `<div class="item-row"><div class="item-thumb"></div>
            <div class="item-info"><div class="item-title">${n.title}</div><div class="item-meta">${range}</div></div>
            <div class="item-actions">
                <button class="icon-btn edit" onclick="window.editNews(${i})">編輯</button>
                <button class="icon-btn danger" onclick="window.deleteNews(${i})">刪除</button>
            </div></div>`;
    }).join('');
}

window.editNews = function (index) {
    const n = editState.news.items[index];
    document.getElementById('news-title').value = n.title || '';
    document.getElementById('news-content').value = n.content || '';
    document.getElementById('news-startAt').value = msToDateValue(n.startAt);
    document.getElementById('news-endAt').value = msToDateValue(n.endAt);
    enterEditMode('news', true);
    editState.news.editingId = index;
    document.getElementById('panel-news').scrollIntoView({ behavior: 'smooth' });
};

window.deleteNews = async function (index) {
    if (!confirm('確定要刪除嗎？此動作無法復原。')) return;
    editState.news.items.splice(index, 1);
    await saveNewsFile('刪除公告');
};

async function saveNewsFile(message) {
    try {
        const result = await writeJsonFile('data/news.json', editState.news.items, editState.news.sha, message);
        editState.news.sha = result.content.sha;
        renderNewsList();
        showMsg('news', '已儲存');
    } catch (err) {
        showMsg('news', err.message, true);
        await loadNewsList();
    }
}

window.submitNews = async function (e) {
    e.preventDefault();
    try {
        const editingIndex = editState.news.editingId;
        const data = {
            title: document.getElementById('news-title').value,
            content: document.getElementById('news-content').value || '',
            startAt: dateToMs(document.getElementById('news-startAt').value),
            endAt: dateToMs(document.getElementById('news-endAt').value)
        };

        if (editingIndex !== null) {
            const existing = editState.news.items[editingIndex];
            editState.news.items[editingIndex] = { ...existing, ...data };
        } else {
            editState.news.items.push({ id: 'news_' + Date.now(), publishedAt: Date.now(), ...data });
        }

        await saveNewsFile(editingIndex !== null ? '更新公告' : '新增公告');
        window.cancelEdit('news');
    } catch (err) { showMsg('news', err.message, true); }
    return false;
};

/* =====================================================
   徽章 / 證書（data/badges.json、data/certificates.json，物件字典）
===================================================== */
async function loadDictList(coll) {
    const { data, sha } = await readJsonFile(`data/${coll}.json`, {});
    editState[coll].items = data;
    editState[coll].sha = sha;
    renderDictList(coll);
}

function renderDictList(coll) {
    const wrap = document.getElementById(`${coll}-list`);
    const items = editState[coll].items;
    const ids = Object.keys(items);
    if (ids.length === 0) { wrap.innerHTML = `<p class="empty-note">尚無資料</p>`; return; }
    wrap.innerHTML = ids.map(id => {
        const b = items[id];
        return `<div class="item-row">
            ${b.iconUrl ? `<img class="item-thumb" src="${b.iconUrl}">` : `<div class="item-thumb"></div>`}
            <div class="item-info"><div class="item-title">${b.name} <span style="color:#999;font-weight:400;">(${id})</span></div>
                <div class="item-meta">來源任務：${b.sourceTaskId || '（未設定）'}</div></div>
            <div class="item-actions">
                <button class="icon-btn edit" onclick="window.editDict('${coll}','${id}')">編輯</button>
                <button class="icon-btn danger" onclick="window.deleteDict('${coll}','${id}')">刪除</button>
            </div>
        </div>`;
    }).join('');
}

window.editDict = function (coll, id) {
    const b = editState[coll].items[id];
    document.getElementById(`${coll}-id`).value = id;
    document.getElementById(`${coll}-name`).value = b.name || '';
    document.getElementById(`${coll}-description`).value = b.description || '';
    document.getElementById(`${coll}-sourceTaskId`).value = b.sourceTaskId || '';
    showExistingImage(coll, b.iconUrl);
    enterEditMode(coll, false);
    editState[coll].editingId = id;
    document.getElementById(`panel-${coll}`).scrollIntoView({ behavior: 'smooth' });
};

window.deleteDict = async function (coll, id) {
    if (!confirm('確定要刪除嗎？此動作無法復原。')) return;
    delete editState[coll].items[id];
    await saveDictFile(coll, `刪除 ${coll} ${id}`);
};

async function saveDictFile(coll, message) {
    try {
        const result = await writeJsonFile(`data/${coll}.json`, editState[coll].items, editState[coll].sha, message);
        editState[coll].sha = result.content.sha;
        renderDictList(coll);
        showMsg(coll, '已儲存');
    } catch (err) {
        showMsg(coll, err.message, true);
        await loadDictList(coll);
    }
}

async function submitDict(coll, e) {
    e.preventDefault();
    const id = document.getElementById(`${coll}-id`).value.trim();
    try {
        const editingId = editState[coll].editingId;
        const existing = editingId ? editState[coll].items[editingId] : null;

        if (!editingId && editState[coll].items[id]) {
            showMsg(coll, '此 ID 已存在，請換一個', true);
            return false;
        }

        const iconUrl = await uploadPendingImage(coll, existing?.iconUrl);
        editState[coll].items[id] = {
            name: document.getElementById(`${coll}-name`).value,
            description: document.getElementById(`${coll}-description`).value || '',
            iconUrl,
            sourceTaskId: document.getElementById(`${coll}-sourceTaskId`).value || ''
        };

        await saveDictFile(coll, editingId ? `更新 ${coll} ${id}` : `新增 ${coll} ${id}`);
        window.cancelEdit(coll);
    } catch (err) { showMsg(coll, err.message, true); }
    return false;
}
window.submitBadge = (e) => submitDict('badges', e);
window.submitCertificate = (e) => submitDict('certificates', e);

/* =====================================================
   一次性載入所有內容清單
===================================================== */
async function loadAllContentLists() {
    await Promise.all([
        loadBannersList(), loadTasksList(), loadNewsList(),
        loadDictList('badges'), loadDictList('certificates')
    ]);
}

/* =====================================================
   使用者資料編修（維持 Firebase Google 登入 + Firestore）
===================================================== */
window.handleGoogleLogin = async function () {
    try { await signInWithPopup(auth, new GoogleAuthProvider()); }
    catch (err) { document.getElementById('users-login-error').innerText = err.message; }
};
window.handleGoogleLogout = async function () { await signOut(auth); };

window.searchUser = async function (e) {
    e.preventDefault();
    const username = document.getElementById('user-search-input').value.trim().toLowerCase();
    await loadUserIntoForm(username);
    return false;
};

// 直接用 uid 載入（清單點擊用，不用再多查一次 usernames）
async function loadUserByUid(uid) {
    const area = document.getElementById('user-edit-area');
    area.innerHTML = '查詢中...';
    const userSnap = await getDoc(doc(db, 'users', uid));
    if (!userSnap.exists()) { area.innerHTML = '<p style="font-size:13px;">查無使用者資料</p>'; return; }
    renderUserEditForm(uid, userSnap.data());
}

async function loadUserIntoForm(username) {
    const area = document.getElementById('user-edit-area');
    area.innerHTML = '查詢中...';
    const unameSnap = await getDoc(doc(db, 'usernames', username));
    if (!unameSnap.exists()) { area.innerHTML = '<p style="font-size:13px;">查無此使用者</p>'; return; }
    await loadUserByUid(unameSnap.data().uid);
}

function renderUserEditForm(uid, u) {
    const area = document.getElementById('user-edit-area');
    area.innerHTML = `
        <form class="entity-form" onsubmit="return window.submitUserEdit(event, '${uid}')">
            <div class="field"><label>暱稱</label><input name="nickname" value="${u.nickname || ''}"></div>
            <div class="two-col">
                <div class="field"><label>等級</label><input name="level" type="number" value="${u.level ?? 1}"></div>
                <div class="field"><label>通行金幣</label><input name="coins" type="number" value="${u.coins ?? 0}"></div>
            </div>
            <div class="field"><label>徽章（逗號分隔ID）</label><input name="badges" value="${(u.badges || []).join(',')}"></div>
            <div class="field"><label>證書（逗號分隔ID）</label><input name="certificates" value="${(u.certificates || []).join(',')}"></div>
            <button class="btn-save" type="submit">儲存變更</button>
        </form>`;
}

// 瀏覽全部使用者（Firestore users collection 目前設定任何人可讀，
// 這裡仍限定要先通過管理者 Google 登入才看得到這個畫面）
window.loadUsersList = async function () {
    const listEl = document.getElementById('users-list');
    const loadingEl = document.getElementById('users-list-loading');
    loadingEl.classList.remove('hidden');
    listEl.innerHTML = '';
    try {
        const snap = await getDocs(collection(db, 'users'));
        loadingEl.classList.add('hidden');
        if (snap.empty) { listEl.innerHTML = `<p class="empty-note">目前沒有任何使用者</p>`; return; }
        const rows = snap.docs
            .map(d => ({ uid: d.id, ...d.data() }))
            .sort((a, b) => (a.nickname || '').localeCompare(b.nickname || ''));
        listEl.innerHTML = rows.map(u => `
            <div class="item-row">
                <div class="item-thumb"></div>
                <div class="item-info">
                    <div class="item-title">${u.nickname || '（未命名）'}</div>
                    <div class="item-meta">Lv.${u.level ?? 1} · ${u.coins ?? 0} 金幣</div>
                </div>
                <div class="item-actions">
                    <button class="icon-btn edit" onclick="window.loadUserByUidFromList('${u.uid}')">編輯</button>
                </div>
            </div>
        `).join('');
    } catch (err) {
        loadingEl.classList.add('hidden');
        listEl.innerHTML = `<p class="empty-note">載入失敗：${err.message}</p>`;
    }
};

window.loadUserByUidFromList = function (uid) { loadUserByUid(uid); };

window.submitUserEdit = async function (e, uid) {
    e.preventDefault();
    const f = new FormData(e.target);
    try {
        await updateDoc(doc(db, 'users', uid), {
            nickname: f.get('nickname'),
            level: Number(f.get('level')),
            coins: Number(f.get('coins')),
            badges: f.get('badges').split(',').map(s => s.trim()).filter(Boolean),
            certificates: f.get('certificates').split(',').map(s => s.trim()).filter(Boolean)
        });
        showMsg('users', '已儲存');
        window.loadUsersList(); // 存檔後刷新左側清單，讓等級/金幣顯示同步最新
    } catch (err) { showMsg('users', err.message, true); }
    return false;
};

onAuthStateChanged(auth, async (user) => {
    document.getElementById('users-login-screen').classList.add('hidden');
    document.getElementById('users-not-admin').classList.add('hidden');
    document.getElementById('users-panel-content').classList.add('hidden');

    if (!user) { document.getElementById('users-login-screen').classList.remove('hidden'); return; }

    const adminSnap = await getDoc(doc(db, 'admins', user.uid));
    if (!adminSnap.exists()) { document.getElementById('users-not-admin').classList.remove('hidden'); return; }

    document.getElementById('users-panel-content').classList.remove('hidden');
    window.loadUsersList();
});

/* =====================================================
   初始化：先看有沒有 GitHub 連線設定
===================================================== */
(function init() {
    const cfg = getGhConfig();
    if (cfg) {
        showGhApp();
    } else {
        document.getElementById('gh-setup-screen').classList.remove('hidden');
    }
})();
