// =====================================================================
// 在地文化知識型互動平台 — 主程式
// =====================================================================
import { auth } from './firebase-config.js';
import {
    registerUser, loginUser, logoutUser, changePassword, watchAuthState, validateUsername, validatePassword
} from './auth.js';
import {
    loadActiveBanners, loadTasks, loadNews, loadBadges, loadCertificates, loadAvatarPresets, loadShopItems, loadSettings
} from './content.js';
import { claimDailyLogin, redeemShopItem } from './coins.js';
import { openTask, initTaskMessageListener } from './tasks.js';
import { fetchLeaderboard } from './leaderboard.js';
import { openDailySlot } from './dailySlot.js';

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
// 等級純計算，不存進 Firestore：背包裡每 N 個已得物件（徽章+證書加權合計）升一級，
// N 是 data/settings.json 的 levelStep，後台可以直接改、不用改程式碼——
// 這裡不再寫死常數，改成每次都讀 siteData.settings，萬一 loadAllContent() 還沒
// 跑完（siteData 尚未賦值）就有地方呼叫到，用 25 當一個合理的備援預設值。
// 權重讀 data/badges.json／certificates.json 的 weight 欄位，沒設定就當作 1（等同「每個算1個」）。
function getLevelStep() {
    return siteData?.settings?.levelStep ?? 25;
}

function computeLevelInfo(user) {
    const levelStep = getLevelStep();
    if (!user) return { level: 1, current: 0, target: levelStep };
    const badgeWeight = (user.badges || []).reduce((sum, id) => sum + (siteData.badges[id]?.weight ?? 1), 0);
    const certWeight = (user.certificates || []).reduce((sum, id) => sum + (siteData.certificates[id]?.weight ?? 1), 0);
    const totalWeight = badgeWeight + certWeight;
    return {
        level: Math.floor(totalWeight / levelStep) + 1,
        current: totalWeight % levelStep,
        target: levelStep
    };
}

function computeLevel(user) {
    return computeLevelInfo(user).level;
}

function computeUnlockStatus(task, user) {
    const conditions = task.unlockConditions || [];
    if (conditions.length === 0) return { canPlay: true, reason: '自由參加' };
    if (!user) return { canPlay: false, reason: '請先登記通行證' };

    const today = Date.now();
    const reasons = [];

    for (const cond of conditions) {
        switch (cond.type) {
            case 'LEVEL':
                if (computeLevel(user) < cond.value) reasons.push(`需達 Lv.${cond.value}`);
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

// 每日拉霸上限：讀後台 data/settings.json 的 dailyLoginCoins，夾在 1 ~ 50 之間。
// 50 是 firestore.rules 的 MAX_SINGLE_TX()，超過會被規則拒絕、玩家整筆領不到。
function getDailySlotCap() {
    const raw = Math.floor(Number(siteData?.settings?.dailyLoginCoins));
    const n = Number.isFinite(raw) ? raw : 10;
    return Math.min(50, Math.max(1, n));
}

// 當天首次登入：自動跳出拉霸視窗，玩家按下拉霸時才抽結果並發放金幣。
// dailySlotOpen 防止 watchAuthState 短時間內觸發兩次（例如登入權杖刷新）時跳出兩個視窗。
let dailySlotOpen = false;
async function maybeClaimDailyLogin() {
    if (!currentUser || dailySlotOpen) return;
    const today = utc8DayNumber();
    if (currentUser.lastDailyLoginDay === today) return;

    dailySlotOpen = true;
    let claimed = false;
    try {
        await openDailySlot({
            cap: getDailySlotCap(),
            claim: async (amount) => {
                if (!currentUser) return { ok: false, reason: '尚未登入' };
                const result = await claimDailyLogin(currentUser.uid, amount);
                if (result.ok && result.alreadyClaimed) {
                    // Firestore 上其實已經領過了（例如同一天在別的裝置/分頁先領過），
                    // 只更新日期欄位，coins/dailyGuard 不要覆寫成 undefined
                    currentUser = { ...currentUser, lastDailyLoginDay: today };
                } else if (result.ok) {
                    currentUser = { ...currentUser, coins: result.newCoins, lastDailyLoginDay: today, dailyGuard: result.guard };
                    claimed = true;
                } else {
                    console.warn('每日拉霸金幣發放失敗：', result.reason);
                }
                return result;
            }
        });
    } finally {
        dailySlotOpen = false;
    }
    // 等轉盤揭曉、視窗 2 秒後自動關閉之後，才刷新頂部金幣顯示，
    // 避免轉盤還沒停，背後的金幣數字就先跳出來、提前洩漏結果
    if (claimed) {
        renderUserBar();
        renderTasks(); // 金幣餘額變了，任務卡片的「金幣夠不夠」判斷要跟著重新算
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

    // 模式標籤+卡片強調色一起換，兩個畫面外觀不能靠仔細看文字才分得出來
    document.getElementById('auth-mode-badge').innerText = isRegisterMode ? '📝 註冊模式' : '🔑 登入模式';
    document.getElementById('auth-modal-card').classList.toggle('auth-mode-register', isRegisterMode);
    document.getElementById('auth-modal-card').classList.toggle('auth-mode-login', !isRegisterMode);

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
    if (isRegisterMode) {
        const passwordErr = validatePassword(password);
        if (passwordErr) { showAuthError(passwordErr); return; }
    } else if (!password) {
        showAuthError('請輸入密碼'); return;
    }

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
    const progressWrap = document.getElementById('level-progress-wrap');
    if (!currentUser) {
        document.getElementById('user-name').innerText = '未登記隊員';
        document.getElementById('user-level').innerText = 'Lv.0';
        document.getElementById('user-coins').innerText = '0';
        avatarEl.innerText = '🧭';
        avatarEl.style.setProperty('--glow', '#B8863B');
        progressWrap.classList.add('hidden');
        return;
    }
    const avatar = siteData.avatarPresets.find(a => a.id === currentUser.avatarId);
    const levelInfo = computeLevelInfo(currentUser);
    document.getElementById('user-name').innerText = currentUser.nickname;
    document.getElementById('user-level').innerText = `Lv.${levelInfo.level}`;
    document.getElementById('user-coins').innerText = currentUser.coins;
    avatarEl.innerText = avatar?.emoji || '🙂';
    avatarEl.style.setProperty('--glow', avatar?.glowColor || '#B8863B');

    progressWrap.classList.remove('hidden');
    progressWrap.title = `${levelInfo.current} / ${levelInfo.target}，還差 ${levelInfo.target - levelInfo.current} 個升下一級`;
    document.getElementById('level-progress-bar').style.width = `${(levelInfo.current / levelInfo.target) * 100}%`;
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
        const hasImage = !!b.imageUrl;
        return `
        <div class="banner-slide ${clickable ? 'banner-clickable' : ''} ${hasImage ? 'has-image' : ''}"
             style="background-image:${hasImage ? `url('${b.imageUrl}')` : 'var(--banner-gradient)'}"
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
    const coinIconSvg = `<svg class="coin-icon" viewBox="0 0 24 24" width="12" height="12" aria-hidden="true"><circle cx="12" cy="12" r="10" fill="#E8B84B" stroke="#B8863B" stroke-width="1.5"/><circle cx="12" cy="12" r="6.5" fill="none" stroke="#B8863B" stroke-width="1.2" opacity="0.6"/><text x="12" y="16" text-anchor="middle" font-size="10" font-weight="700" fill="#8A5A16">$</text></svg>`;

    container.innerHTML = siteData.tasks.map((task) => {
        const status = computeUnlockStatus(task, currentUser);
        const lockedClass = status.canPlay ? '' : 'grad-locked';
        const bannerHtml = task.bannerUrl
            ? `<img src="${task.bannerUrl}" alt="${task.title}" class="task-banner-img"
                 onerror="this.replaceWith(Object.assign(document.createElement('div'),{className:'task-banner-fallback',textContent:'🎯'}))">`
            : `<div class="task-banner-fallback">🎯</div>`;
        const clickAttr = status.canPlay ? ` onclick="window.handleTaskClick('${task.id}')"` : '';

        return `
            <div class="task-card ${lockedClass}">
                <div class="task-banner-wrap"${clickAttr}>${bannerHtml}</div>
                <div class="task-row-title">
                    <span class="task-name">${task.title}</span>
                    <span class="task-cost">${coinIconSvg}${task.entryCost || 0}</span>
                </div>
                ${status.canPlay ? '' : `<div class="task-row-status">${status.reason}</div>`}
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

const NEWS_PREVIEW_LENGTH = 70; // 超過這個字數就截斷、改用「查看更多」開彈窗看全文

function renderNews() {
    const container = document.getElementById('news-list');
    container.innerHTML = siteData.news.map((n, i) => {
        const content = n.content || '';
        const isLong = content.length > NEWS_PREVIEW_LENGTH;
        const preview = isLong ? content.slice(0, NEWS_PREVIEW_LENGTH) : content;
        return `
        <div class="news-card">
            <div class="news-date">${new Date(n.publishedAt).toISOString().slice(5, 10).replace('-', '/')}</div>
            <div class="news-body">
                <h3 class="news-title">${n.title}</h3>
                <p class="news-content ${isLong ? 'truncated' : ''}" ${isLong ? `onclick="window.showNewsDetail(${i})"` : ''}>${preview}</p>
            </div>
        </div>
    `;
    }).join('') || `<p class="empty-hint">目前尚無公告</p>`;
}

// 公告內容太長時，點擊「查看更多」開跟徽章/證書一樣的 detail-modal 看全文（沿用同一套彈窗元件，介面風格一致）
window.showNewsDetail = function (index) {
    const n = siteData.news[index];
    if (!n) return;
    document.getElementById('detail-modal-title').innerText = n.title;
    document.getElementById('detail-modal-body').innerHTML = `<p style="white-space:pre-wrap;">${n.content || ''}</p>`;
    document.getElementById('detail-modal').classList.remove('hidden');
};

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
    const fallbackIcon = kind === 'badge' ? '🏅' : '📜';
    document.getElementById('detail-modal-title').innerText = item.name;
    document.getElementById('detail-modal-body').innerHTML = `
        <div class="detail-modal-icon">${item.iconUrl ? `<img src="${item.iconUrl}" alt="${item.name}">` : fallbackIcon}</div>
        <p>${item.description || ''}</p>
        <p class="detail-meta">取得方式：完成任務「${sourceTask?.title || '未知任務'}」</p>
        <p class="detail-meta">${owned ? '✅ 已取得' : '尚未取得'}</p>
    `;
    document.getElementById('detail-modal').classList.remove('hidden');
};

window.closeDetailModal = function () {
    document.getElementById('detail-modal').classList.add('hidden');
};

/* ---------------- 商店 ---------------- */
function renderShop() {
    const listEl = document.getElementById('shop-list');
    const items = siteData.shopItems || [];
    if (!items.length) { listEl.innerHTML = `<p class="empty-hint">目前沒有可兌換的品項</p>`; return; }

    listEl.innerHTML = items.map(it => {
        const canAfford = currentUser.coins >= (it.cost || 0);
        return `
        <div class="shop-card">
            <div class="shop-thumb">${it.iconUrl ? `<img src="${it.iconUrl}" alt="">` : '🎁'}</div>
            <div class="shop-info">
                <h4 class="shop-title">${it.name}</h4>
                <p class="shop-desc">${it.description || ''}</p>
            </div>
            <button class="task-btn" ${canAfford ? '' : 'disabled'} onclick="window.handleRedeem('${it.id}')">
                <span class="coin-icon-wrap">🪙${it.cost || 0}</span>
            </button>
        </div>`;
    }).join('');
}

window.handleRedeem = async function (itemId) {
    const item = (siteData.shopItems || []).find(i => i.id === itemId);
    if (!item || !currentUser) return;
    if (!confirm(`確定要用 ${item.cost} 金幣兌換「${item.name}」嗎？`)) return;

    const r = await redeemShopItem(currentUser.uid, item);
    if (!r.ok) { alert(r.reason || '兌換失敗，請稍後再試'); return; }

    currentUser = { ...currentUser, coins: r.newCoins, dailyGuard: r.guard };
    renderUserBar();
    renderShop();

    // 兌換成功後，把這張「收據」用詳情彈窗顯示出來，玩家截圖給店家看即可核銷
    document.getElementById('detail-modal-title').innerText = '兌換成功！';
    document.getElementById('detail-modal-body').innerHTML = `
        <div class="detail-modal-icon">${item.iconUrl ? `<img src="${item.iconUrl}" alt="${item.name}">` : '🎁'}</div>
        <p style="font-weight:800;font-size:16px;">${item.name}</p>
        <p class="detail-meta">花費 ${item.cost} 金幣</p>
        <p class="detail-meta">${new Date(r.redemption.redeemedAt).toLocaleString()}</p>
        <p class="detail-meta" style="margin-top:10px;">📸 請把這個畫面截圖給店家看即可核銷</p>
    `;
    document.getElementById('detail-modal').classList.remove('hidden');
};

/* ---------------- 排行榜 ---------------- */
function renderLeaderboardOptions() {
    const select = document.getElementById('leaderboard-task-select');
    const lbTasks = siteData.tasks.filter(t => t.hasLeaderboard !== false);
    select.innerHTML = lbTasks.length
        ? lbTasks.map(t => `<option value="${t.id}">${t.title}</option>`).join('')
        : '';
    if (lbTasks.length) {
        renderLeaderboard();
    } else {
        document.getElementById('leaderboard-list').innerHTML = `<p class="empty-hint">目前沒有任務開放排行榜</p>`;
    }
}

// 把使用者可控的字串（暱稱、排行榜玩家名/分數字串）安全地插入 HTML，
// 避免有人繞過網頁介面直接寫入含 HTML/script 的內容時被當成程式碼執行（儲存型 XSS 防護）。
function escapeHtml(str) {
    return String(str ?? '').replace(/[&<>"']/g, c => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
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
            <span class="lb-name">${escapeHtml(row.playerName)}</span>
            <span class="lb-score">${escapeHtml(row.scoreLabel)}</span>
        </div>
    `).join('');
};

/* ---------------- 分頁切換 ---------------- */
window.switchTab = function (tabName) {
    if ((tabName === 'bag' || tabName === 'shop') && !currentUser) {
        document.getElementById('auth-modal').classList.remove('hidden');
        return;
    }

    ['home', 'news', 'bag', 'leaderboard', 'shop'].forEach(t => {
        document.getElementById(`tab-${t}`).classList.add('hidden');
        document.getElementById(`nav-${t}`).classList.remove('tab-active');
    });
    document.getElementById(`tab-${tabName}`).classList.remove('hidden');
    document.getElementById(`nav-${tabName}`).classList.add('tab-active');

    if (tabName === 'news') { renderNews(); markNewsAsRead(); }
    if (tabName === 'bag') renderBag();
    if (tabName === 'leaderboard') renderLeaderboardOptions();
    if (tabName === 'shop') renderShop();
};

/* ---------------- 初始化 ---------------- */
// 改用 Promise.allSettled：原本用 Promise.all，只要 7 個資料源裡有任何一個壞掉
// （格式錯誤、404），整個 Promise 就會 reject，siteData 完全沒被賦值，
// 導致 renderBanners()/renderTasks() 用到 undefined 的 siteData 直接壞掉、
// 整個平台首頁一片空白（先前 badges.json 少一個逗號就整站掛掉，就是這個機制）。
// 現在每個資料源獨立失敗、獨立記錄、獨立給空陣列預設值，壞一個只影響那個功能區塊
// （例如 badges.json 壞了，徽章顯示不出來，但任務/公告/banner 照常運作）。
async function loadAllContent() {
    const loaders = {
        banners: loadActiveBanners, tasks: loadTasks, news: loadNews,
        badges: loadBadges, certificates: loadCertificates,
        avatarPresets: loadAvatarPresets, shopItems: loadShopItems,
        settings: loadSettings
    };
    // 大部分內容源失敗時給空陣列當預設沒問題（顯示為空清單），但 settings 是物件
    // 不是清單，玩家端會用 siteData.settings.dailyLoginCoins 這樣的欄位存取，
    // 給空陣列的話會變成 undefined、後面用到的地方就出錯了，所以要給對應的物件預設值。
    // 實務上 loadSettings() 自己內部已經處理過讀取失敗的情況、幾乎不會真的走到這裡，
    // 這裡只是多一層保險。
    const FALLBACKS = { settings: { dailyLoginCoins: 10, levelStep: 25 } };
    const keys = Object.keys(loaders);
    const results = await Promise.allSettled(keys.map(k => loaders[k]()));

    siteData = {};
    results.forEach((r, i) => {
        const key = keys[i];
        if (r.status === 'fulfilled') {
            siteData[key] = r.value;
        } else {
            console.error(`讀取 ${key} 失敗，這個區塊會先顯示為空`, r.reason);
            siteData[key] = FALLBACKS[key] ?? [];
        }
    });
}

function hideLoadingScreen() {
    const el = document.getElementById('loading-screen');
    if (el) el.classList.add('hidden');
}

// 安全機制：正常情況下 watchAuthState 的第一次回呼就會收起載入畫面，
// 但如果網路異常、Firebase 遲遲沒回應，不能讓畫面永遠卡住，
// 10 秒後強制收起，讓使用者至少看得到（可能還沒登入狀態的）畫面可以操作。
setTimeout(hideLoadingScreen, 10000);

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
        hideLoadingScreen(); // 內容跟登入狀態都確認完了，這時候才收起「連線中」畫面
        if (user) await maybeClaimDailyLogin();
    });
}

init();
