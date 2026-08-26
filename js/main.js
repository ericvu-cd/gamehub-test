// =====================================================================
// 在地文化知識型互動平台 — 主程式
// =====================================================================
import { auth } from './firebase-config.js';
import {
    registerUser, loginUser, logoutUser, changePassword, watchAuthState, validateUsername
} from './auth.js';
import {
    loadActiveBanners, loadTasks, loadNews, loadBadges, loadCertificates, loadAvatarPresets
} from './content.js';
import { claimDailyLogin } from './coins.js';
import { openTask, initTaskMessageListener } from './tasks.js';
import { fetchLeaderboard } from './leaderboard.js';

let currentUser = null;
let siteData = { banners: [], tasks: [], news: [], badges: {}, certificates: {}, avatarPresets: [] };
let bannerIndex = 0;
let bannerTimer = null;
let isRegisterMode = false;
let selectedAvatarId = null;

/* ---------------- LINE 內建瀏覽器跳轉 ---------------- */
(function checkLineBrowser() {
    const ua = navigator.userAgent || navigator.vendor || window.opera;
    if (ua.indexOf('LINE') > -1) {
        const currentUrl = window.location.href;
        if (ua.indexOf('Android') > -1) {
            window.location.href = `intent://${currentUrl.replace(/^https?:\/\//, '')}#Intent;scheme=https;package=com.android.chrome;end`;
        } else if (ua.indexOf('iPhone') > -1 || ua.indexOf('iPad') > -1) {
            alert('為了確保平台體驗，請點擊右下角『...』並選擇『以預設瀏覽器開啟』！');
        }
    }
})();

/* ---------------- 解鎖條件判定（多條件 AND） ---------------- */
function computeUnlockStatus(task, user) {
    const conditions = task.unlockConditions || [];
    if (conditions.length === 0) return { canPlay: true, reason: '自由參加' };
    if (!user) return { canPlay: false, reason: '請先登記通行證' };

    const today = Date.now();
    const reasons = [];

    for (const cond of conditions) {
        switch (cond.type) {
            case 'LEVEL':
                if (user.level < cond.value) reasons.push(`需達 Lv.${cond.value}`);
                break;
            case 'COIN':
                if (user.coins < cond.value) reasons.push(`需 ${cond.value} 通行金幣`);
                break;
            case 'BADGE':
                for (const bId of cond.value || []) {
                    if (!user.badges.includes(bId)) {
                        reasons.push(`需取得【${siteData.badges[bId]?.name || '指定徽章'}】`);
                    }
                }
                break;
            case 'CERTIFICATE':
                for (const cId of cond.value || []) {
                    if (!user.certificates.includes(cId)) {
                        reasons.push(`需取得【${siteData.certificates[cId]?.name || '指定證書'}】`);
                    }
                }
                break;
            case 'DATE':
                if (today < cond.startDate || today > cond.endDate) {
                    reasons.push(`限定期間開放`);
                }
                break;
        }
    }

    if (reasons.length === 0) return { canPlay: true, reason: '條件已達成' };
    return { canPlay: false, reason: reasons[0] };
}

/* ---------------- 每日登入獎勵（登入後自動檢查） ---------------- */
function utc8DayNumber() {
    return Math.floor((Date.now() + 8 * 60 * 60 * 1000) / (24 * 60 * 60 * 1000));
}

async function maybeClaimDailyLogin() {
    if (!currentUser) return;
    const today = utc8DayNumber();
    if (currentUser.lastDailyLoginDay === today) return;
    const result = await claimDailyLogin(currentUser.uid, currentUser.coins, currentUser.dailyGuard);
    if (result.ok) {
        currentUser = { ...currentUser, coins: result.newCoins, lastDailyLoginDay: today, dailyGuard: result.guard };
        renderUserBar();
        showToast('每日登入獎勵 +10 通行金幣！');
    } else {
        console.warn('每日登入獎勵領取失敗：', result.reason);
    }
}

function showToast(text) {
    const el = document.createElement('div');
    el.className = 'toast';
    el.textContent = text;
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 2600);
}

/* ---------------- Auth UI ---------------- */
window.toggleAuthMode = function () {
    isRegisterMode = !isRegisterMode;

    document.getElementById('auth-title').innerText = isRegisterMode ? '申請加入探索隊' : '通行證登記';
    document.getElementById('auth-sub').innerText = isRegisterMode
        ? '第一次來嗎？建立你自己的通行證'
        : '已有帳號的隊員，請在這裡登入';
    document.getElementById('auth-submit-text').innerText = isRegisterMode ? '核發通行證' : '登記';
    document.getElementById('auth-toggle-link').innerText = isRegisterMode
        ? '已經有通行證了？點此登入'
        : '還沒有通行證？點此申請加入';

    document.getElementById('auth-avatar-wrap').classList.toggle('hidden', !isRegisterMode);
    document.getElementById('auth-notice-wrap').classList.toggle('hidden', !isRegisterMode);

    // 註冊時密碼預設可視，方便確認輸入正確；登入時維持遮蔽保護隱私
    const pwdInput = document.getElementById('auth-password');
    const pwdToggleBtn = document.getElementById('auth-password-toggle');
    pwdInput.type = isRegisterMode ? 'text' : 'password';
    pwdToggleBtn.classList.toggle('hidden', !isRegisterMode);
    pwdToggleBtn.innerText = '隱藏';

    if (isRegisterMode) renderAvatarPicker();
};

window.togglePasswordVisibility = function () {
    const pwdInput = document.getElementById('auth-password');
    const btn = document.getElementById('auth-password-toggle');
    const showing = pwdInput.type === 'text';
    pwdInput.type = showing ? 'password' : 'text';
    btn.innerText = showing ? '顯示' : '隱藏';
};

function renderAvatarPicker() {
    const wrap = document.getElementById('avatar-picker');
    wrap.innerHTML = siteData.avatarPresets.map(a => `
        <button type="button" onclick="window.selectAvatar('${a.id}')"
            class="avatar-choice ${selectedAvatarId === a.id ? 'selected' : ''}"
            style="--glow:${a.glowColor || '#B8863B'}">${a.emoji}</button>
    `).join('');
    if (!selectedAvatarId && siteData.avatarPresets.length) {
        selectedAvatarId = siteData.avatarPresets[0].id;
    }
}

window.selectAvatar = function (avatarId) {
    selectedAvatarId = avatarId;
    renderAvatarPicker();
};

let isSubmitting = false;

window.handleAuthSubmit = async function () {
    if (isSubmitting) return; // 防止連點造成重複送出

    const username = document.getElementById('auth-username').value.trim();
    const password = document.getElementById('auth-password').value;
    const errorEl = document.getElementById('auth-error');
    errorEl.classList.add('hidden');

    const usernameErr = validateUsername(username);
    if (usernameErr) { showAuthError(usernameErr); return; }
    if (!password) { showAuthError('請輸入密碼'); return; }

    const submitBtn = document.getElementById('auth-submit-btn');
    const submitText = document.getElementById('auth-submit-text');
    const submitSpinner = document.getElementById('auth-submit-spinner');
    isSubmitting = true;
    submitBtn.disabled = true;
    submitText.classList.add('hidden');
    submitSpinner.classList.remove('hidden');

    try {
        if (isRegisterMode) {
            const notice = document.getElementById('auth-notice-checkbox');
            if (!notice.checked) { showAuthError('請先勾選確認已知悉沒有密碼救援服務'); return; }
            // registerUser() 內部的 createUserWithEmailAndPassword 本身就會讓使用者
            // 直接處於登入狀態，不需要再多呼叫一次 loginUser()（原本這裡多打一次，
            // 是造成註冊流程變慢的主因之一）。
            await registerUser(username, password, siteData.avatarPresets.map(a => a.id));
        } else {
            await loginUser(username, password);
        }
        document.getElementById('auth-modal').classList.add('hidden');
    } catch (err) {
        showAuthError(err.message);
    } finally {
        isSubmitting = false;
        submitBtn.disabled = false;
        submitText.classList.remove('hidden');
        submitSpinner.classList.add('hidden');
    }
};

function showAuthError(text) {
    const el = document.getElementById('auth-error');
    el.innerText = text;
    el.classList.remove('hidden');
}

window.handleLogout = async function () {
    await logoutUser();
    document.getElementById('user-menu').classList.add('hidden');
    document.getElementById('auth-modal').classList.remove('hidden');
};

window.toggleUserMenu = function () {
    document.getElementById('user-menu').classList.toggle('hidden');
};

window.openChangePasswordModal = function () {
    document.getElementById('user-menu').classList.add('hidden');
    document.getElementById('pwd-modal').classList.remove('hidden');
};

window.closeChangePasswordModal = function () {
    document.getElementById('pwd-modal').classList.add('hidden');
};

window.handleChangePassword = async function () {
    const current = document.getElementById('pwd-current').value;
    const next = document.getElementById('pwd-new').value;
    const errorEl = document.getElementById('pwd-error');
    errorEl.classList.add('hidden');
    try {
        await changePassword(currentUser.nickname, current, next);
        document.getElementById('pwd-modal').classList.add('hidden');
        showToast('密碼已更新');
    } catch (err) {
        errorEl.innerText = err.message;
        errorEl.classList.remove('hidden');
    }
};

/* ---------------- 使用者狀態列 ---------------- */
function renderUserBar() {
    const avatarEl = document.getElementById('user-avatar');
    if (!currentUser) {
        document.getElementById('user-name').innerText = '未登記隊員';
        document.getElementById('user-level').innerText = '等級 Lv.0';
        document.getElementById('user-coins').innerText = '0';
        avatarEl.innerText = '🧭';
        avatarEl.style.setProperty('--glow', '#B8863B');
        return;
    }
    const avatar = siteData.avatarPresets.find(a => a.id === currentUser.avatarId);
    document.getElementById('user-name').innerText = currentUser.nickname;
    document.getElementById('user-level').innerText = `等級 Lv.${currentUser.level}`;
    document.getElementById('user-coins').innerText = currentUser.coins;
    avatarEl.innerText = avatar?.emoji || '🙂';
    avatarEl.style.setProperty('--glow', avatar?.glowColor || '#B8863B');
}

/* ---------------- Banner 輪播 ---------------- */
function renderBanners() {
    const track = document.getElementById('banner-track');
    const dotsWrap = document.getElementById('banner-dots');
    if (siteData.banners.length === 0) {
        track.innerHTML = `<div class="banner-slide banner-empty">目前沒有進行中的活動</div>`;
        dotsWrap.innerHTML = '';
        return;
    }
    track.innerHTML = siteData.banners.map((b, i) => {
        const clickable = b.actionType && b.actionType !== 'NONE' && b.actionValue;
        return `
        <div class="banner-slide ${clickable ? 'banner-clickable' : ''}"
             style="background-image:${b.imageUrl ? `url('${b.imageUrl}')` : 'var(--banner-gradient)'}"
             onclick="window.handleBannerClick(${i})">
            <span class="banner-eyebrow">本週特別任務</span>
            <h2 class="banner-title">${b.title}</h2>
            <p class="banner-sub">${b.subtitle || ''}</p>
            ${clickable ? '<span class="banner-tap-hint">點擊查看 ›</span>' : ''}
        </div>
    `;
    }).join('');
    dotsWrap.innerHTML = siteData.banners.map((_, i) =>
        `<span class="banner-dot ${i === bannerIndex ? 'active' : ''}"></span>`
    ).join('');
    updateBannerPosition();
    resetBannerTimer();
}

window.handleBannerClick = function (index) {
    const b = siteData.banners[index];
    if (!b || !b.actionType || b.actionType === 'NONE' || !b.actionValue) return;

    if (b.actionType === 'URL') {
        window.open(b.actionValue, '_blank');
    } else if (b.actionType === 'TASK') {
        window.handleTaskClick(b.actionValue);
    }
};

function updateBannerPosition() {
    const track = document.getElementById('banner-track');
    track.style.transform = `translateX(-${bannerIndex * 100}%)`;
    document.querySelectorAll('.banner-dot').forEach((d, i) => d.classList.toggle('active', i === bannerIndex));
}

function resetBannerTimer() {
    clearInterval(bannerTimer);
    if (siteData.banners.length <= 1) return;
    bannerTimer = setInterval(() => {
        bannerIndex = (bannerIndex + 1) % siteData.banners.length;
        updateBannerPosition();
    }, 5000); // 自動輪播間隔 5 秒
}

let touchStartX = 0;
document.addEventListener('DOMContentLoaded', () => {
    const track = document.getElementById('banner-track');
    track.addEventListener('touchstart', e => { touchStartX = e.touches[0].clientX; });
    track.addEventListener('touchend', e => {
        const diff = e.changedTouches[0].clientX - touchStartX;
        if (Math.abs(diff) < 40 || siteData.banners.length <= 1) return;
        bannerIndex = diff > 0
            ? (bannerIndex - 1 + siteData.banners.length) % siteData.banners.length
            : (bannerIndex + 1) % siteData.banners.length;
        updateBannerPosition();
        resetBannerTimer();
    });
});

/* ---------------- 任務清單 ---------------- */
function renderTasks() {
    const container = document.getElementById('task-list');
    if (siteData.tasks.length === 0) {
        container.innerHTML = `<p class="empty-hint">目前尚未上架任何任務</p>`;
        return;
    }
    container.innerHTML = siteData.tasks.map((task) => {
        const status = computeUnlockStatus(task, currentUser);
        const themeClass = `theme-${task.colorTheme || 'mint'}`;
        const lockedClass = status.canPlay ? '' : 'grad-locked';
        const thumbHtml = task.iconUrl
            ? `<img src="${task.iconUrl}" alt="" class="task-thumb-img ${status.canPlay ? '' : 'grayscale'}">`
            : `<div class="task-thumb-fallback ${status.canPlay ? themeClass : ''}"></div>`;
        return `
            <div class="task-card ${lockedClass}">
                <div class="task-thumb">${thumbHtml}</div>
                <div class="task-info">
                    <h4 class="task-title">${task.title}</h4>
                    <p class="task-desc">${task.description || ''}</p>
                    <span class="task-status">${status.reason}</span>
                </div>
                <button class="task-btn" ${status.canPlay ? '' : 'disabled'}
                    onclick="window.handleTaskClick('${task.id}')">${status.canPlay ? '出發' : '未解鎖'}</button>
            </div>
        `;
    }).join('');
}

window.handleTaskClick = async function (taskId) {
    const task = siteData.tasks.find(t => t.id === taskId);
    if (!task) return;
    await openTask(task, currentUser, (newCoins, guard) => {
        currentUser = { ...currentUser, coins: newCoins, dailyGuard: guard ?? currentUser.dailyGuard };
        renderUserBar();
        renderTasks();
    });
};

/* ---------------- 公告欄 ---------------- */
function hasUnreadNews() {
    if (!currentUser || siteData.news.length === 0) return false;
    const lastViewed = currentUser.lastNewsViewedAt || 0;
    return siteData.news.some(n => (n.publishedAt || 0) > lastViewed);
}

function renderNewsBadgeDot() {
    document.getElementById('nav-news-dot').classList.toggle('hidden', !hasUnreadNews());
}

function renderNews() {
    const container = document.getElementById('news-list');
    container.innerHTML = siteData.news.map(n => `
        <div class="news-card">
            <div class="news-date">${new Date(n.publishedAt).toISOString().slice(5, 10).replace('-', '/')}</div>
            <div class="news-body">
                <h3 class="news-title">${n.title}</h3>
                <p class="news-content">${n.content || ''}</p>
            </div>
        </div>
    `).join('') || `<p class="empty-hint">目前尚無公告</p>`;
}

async function markNewsAsRead() {
    if (!currentUser) return;
    const { doc, updateDoc } = await import("https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js");
    const { db } = await import('./firebase-config.js');
    const now = Date.now();
    try {
        await updateDoc(doc(db, 'users', currentUser.uid), { lastNewsViewedAt: now });
        currentUser = { ...currentUser, lastNewsViewedAt: now };
        renderNewsBadgeDot();
    } catch (err) { /* 非關鍵操作，失敗不影響使用 */ }
}

/* ---------------- 探索背包 ---------------- */
function renderBag() {
    const badgeGrid = document.getElementById('badge-grid');
    badgeGrid.innerHTML = Object.entries(siteData.badges).map(([id, b]) => {
        const owned = currentUser.badges.includes(id);
        return `<button class="collectible ${owned ? '' : 'locked'}" onclick="window.showCollectibleDetail('badge','${id}')">
            <span class="collectible-icon">${b.iconUrl ? `<img src="${b.iconUrl}">` : '🏅'}</span>
            <span class="collectible-name">${b.name}</span>
        </button>`;
    }).join('') || `<p class="empty-hint">尚無徽章資料</p>`;

    const certGrid = document.getElementById('cert-grid');
    certGrid.innerHTML = Object.entries(siteData.certificates).map(([id, c]) => {
        const owned = currentUser.certificates.includes(id);
        return `<button class="collectible ${owned ? '' : 'locked'}" onclick="window.showCollectibleDetail('certificate','${id}')">
            <span class="collectible-icon">${c.iconUrl ? `<img src="${c.iconUrl}">` : '📜'}</span>
            <span class="collectible-name">${c.name}</span>
        </button>`;
    }).join('') || `<p class="empty-hint">尚無證書資料</p>`;
}

window.showCollectibleDetail = function (kind, id) {
    const dict = kind === 'badge' ? siteData.badges : siteData.certificates;
    const item = dict[id];
    const owned = kind === 'badge' ? currentUser.badges.includes(id) : currentUser.certificates.includes(id);
    const sourceTask = siteData.tasks.find(t => t.id === item.sourceTaskId);
    document.getElementById('detail-modal-title').innerText = item.name;
    document.getElementById('detail-modal-body').innerHTML = `
        <p>${item.description || ''}</p>
        <p class="detail-meta">取得方式：完成任務「${sourceTask?.title || '未知任務'}」</p>
        <p class="detail-meta">${owned ? '✅ 已取得' : '尚未取得'}</p>
    `;
    document.getElementById('detail-modal').classList.remove('hidden');
};

window.closeDetailModal = function () {
    document.getElementById('detail-modal').classList.add('hidden');
};

/* ---------------- 排行榜 ---------------- */
function renderLeaderboardOptions() {
    const select = document.getElementById('leaderboard-task-select');
    select.innerHTML = siteData.tasks.map(t => `<option value="${t.id}">${t.title}</option>`).join('');
    if (siteData.tasks.length) renderLeaderboard();
}

window.renderLeaderboard = async function () {
    const taskId = document.getElementById('leaderboard-task-select').value;
    const container = document.getElementById('leaderboard-list');
    if (!taskId) return;
    container.innerHTML = `<div class="skeleton"></div>`;
    const rows = await fetchLeaderboard(taskId);
    if (rows.length === 0) {
        container.innerHTML = `<p class="empty-hint">尚無排行紀錄</p>`;
        return;
    }
    container.innerHTML = rows.map((row, i) => `
        <div class="lb-row ${i < 3 ? `lb-top${i + 1}` : ''}">
            <span class="lb-rank">No.${i + 1}</span>
            <span class="lb-name">${row.playerName}</span>
            <span class="lb-score">${row.scoreLabel}</span>
        </div>
    `).join('');
};

/* ---------------- 分頁切換 ---------------- */
window.switchTab = function (tabName) {
    if (tabName === 'bag' && !currentUser) {
        document.getElementById('auth-modal').classList.remove('hidden');
        return;
    }

    ['home', 'news', 'bag', 'leaderboard'].forEach(t => {
        document.getElementById(`tab-${t}`).classList.add('hidden');
        document.getElementById(`nav-${t}`).classList.remove('tab-active');
    });
    document.getElementById(`tab-${tabName}`).classList.remove('hidden');
    document.getElementById(`nav-${tabName}`).classList.add('tab-active');

    if (tabName === 'news') { renderNews(); markNewsAsRead(); }
    if (tabName === 'bag') renderBag();
    if (tabName === 'leaderboard') renderLeaderboardOptions();
};

/* ---------------- 初始化 ---------------- */
async function loadAllContent() {
    const [banners, tasks, news, badges, certificates, avatarPresets] = await Promise.all([
        loadActiveBanners(), loadTasks(), loadNews(), loadBadges(), loadCertificates(), loadAvatarPresets()
    ]);
    siteData = { banners, tasks, news, badges, certificates, avatarPresets };
}

async function init() {
    try {
        await loadAllContent();
    } catch (err) {
        console.error('讀取內容資料失敗', err);
    }

    renderBanners();
    renderTasks();

    initTaskMessageListener(
        () => currentUser,
        (updatedUser) => { currentUser = updatedUser; renderUserBar(); renderTasks(); }
    );

    watchAuthState(async (user) => {
        currentUser = user;
        renderUserBar();
        renderTasks();
        renderNewsBadgeDot();
        document.getElementById('auth-modal').classList.toggle('hidden', !!user);
        if (user) await maybeClaimDailyLogin();
    });
}

init();
