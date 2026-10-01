// =====================================================================
// 安裝到主畫面的引導
// - Android（Chrome 等）：瀏覽器提供安裝事件，點「安裝」直接跳出系統安裝視窗
// - iPhone／iPad：蘋果不允許網頁自己跳安裝視窗，只能圖文教學「分享 → 加入主畫面」
// - LINE、Facebook 等 App 內建瀏覽器：在裡面無法安裝，提示改用 Safari／Chrome 開啟
// - 已經是從主畫面 App 打開的：完全不顯示
// 顯示時機：玩家玩完（關閉）第一個任務後自動提示一次；使用者選單另有固定入口。
// 玩家選「不再提示」後就不會再自動跳出，但選單入口一直都在。
// =====================================================================

const DISMISS_KEY = 'gh_install_guide_dismissed'; // 'never'＝不再自動提示
let deferredPrompt = null;
let shownThisSession = false;

// 越早掛越好：瀏覽器判斷可安裝時會發出這個事件，先攔下來，等玩家按按鈕才真正跳出
window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;
});
window.addEventListener('appinstalled', () => {
    deferredPrompt = null;
    try { localStorage.setItem(DISMISS_KEY, 'never'); } catch {}
    updateMenuEntry();
});

export function isStandalone() {
    return window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
}

function detectEnv() {
    const ua = navigator.userAgent || '';
    const isIOS = /iPhone|iPad|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    const inApp = /FBAN|FBAV|FB_IAB|Instagram|Line\/|Messenger|MicroMessenger|KAKAOTALK|Twitter/i.test(ua);
    return { isIOS, inApp };
}

function injectStyles() {
    if (document.getElementById('ig-style')) return;
    const style = document.createElement('style');
    style.id = 'ig-style';
    style.textContent = `
    .ig-overlay { position: fixed; inset: 0; z-index: 180; background: rgba(6,10,28,0.72);
        display: flex; align-items: flex-end; justify-content: center; padding: 16px; }
    .ig-card { width: 100%; max-width: 380px; background: #151d52; color: #fff; border-radius: 18px;
        padding: 20px 20px calc(16px + env(safe-area-inset-bottom)); box-shadow: 0 -6px 30px rgba(0,0,0,0.4);
        border: 1px solid rgba(255,255,255,0.14); font-family: inherit; }
    .ig-head { display: flex; align-items: center; gap: 12px; margin-bottom: 12px; }
    .ig-head img { width: 48px; height: 48px; border-radius: 12px; }
    .ig-title { font-size: 1.05rem; font-weight: 900; }
    .ig-sub { font-size: 0.8rem; color: rgba(255,255,255,0.65); margin-top: 2px; }
    .ig-steps { margin: 6px 0 14px; padding: 0; list-style: none; font-size: 0.92rem; line-height: 1.7; }
    .ig-steps li { display: flex; align-items: center; gap: 8px; padding: 6px 0; }
    .ig-num { flex: 0 0 auto; width: 22px; height: 22px; border-radius: 50%; background: #f6b32d; color: #1a1a1a;
        font-size: 0.75rem; font-weight: 900; display: flex; align-items: center; justify-content: center; }
    .ig-icon { display: inline-flex; vertical-align: middle; }
    .ig-btns { display: flex; gap: 8px; }
    .ig-btn { flex: 1; padding: 11px 8px; border-radius: 12px; border: none; font-weight: 800; font-size: 0.9rem;
        cursor: pointer; font-family: inherit; }
    .ig-btn.primary { background: linear-gradient(135deg, #ffe37a, #f6b32d); color: #3a2a00; }
    .ig-btn.ghost { background: rgba(255,255,255,0.12); color: #fff; }
    `;
    document.head.appendChild(style);
}

// iPhone 分享按鈕的示意圖示（方框加向上箭頭）
const SHARE_ICON = `<svg class="ig-icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#7fb8ff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v12"/><path d="M8 7l4-4 4 4"/><path d="M5 12v7a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-7"/></svg>`;
const ADD_ICON = `<svg class="ig-icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round"><rect x="4" y="4" width="16" height="16" rx="4"/><path d="M12 8v8M8 12h8"/></svg>`;

function buildContent({ isIOS, inApp }) {
    if (inApp) {
        return {
            sub: '目前在 App 內建的瀏覽器中，無法安裝',
            steps: [
                '點右上角的選單（「⋯」或「⋮」）',
                isIOS ? '選「在 Safari 中開啟」' : '選「在瀏覽器中開啟」或「以 Chrome 開啟」',
                '在 Safari／Chrome 打開後，再依照指示加到主畫面'
            ],
            primary: null
        };
    }
    if (deferredPrompt) {
        return { sub: '加到主畫面，像 App 一樣全螢幕使用', steps: [], primary: 'install' };
    }
    if (isIOS) {
        return {
            sub: '加到主畫面，像 App 一樣全螢幕使用',
            steps: [
                `點瀏覽器的分享按鈕 ${SHARE_ICON}（Safari 在畫面下方，Chrome 在網址列右側）`,
                `往下找到並點選「加入主畫面」${ADD_ICON}`,
                '按右上角「新增」，之後從主畫面的圖示打開即可'
            ],
            primary: null
        };
    }
    return {
        sub: '加到主畫面，像 App 一樣全螢幕使用',
        steps: [
            '點瀏覽器右上角的選單「⋮」',
            '選「安裝應用程式」或「加到主畫面」',
            '確認後，之後從主畫面的圖示打開即可'
        ],
        primary: null
    };
}

function showGuide({ auto }) {
    if (document.querySelector('.ig-overlay')) return;
    injectStyles();
    const env = detectEnv();
    const content = buildContent(env);

    const overlay = document.createElement('div');
    overlay.className = 'ig-overlay';
    const stepsHtml = content.steps.map((s, i) => `<li><span class="ig-num">${i + 1}</span><span>${s}</span></li>`).join('');
    overlay.innerHTML = `
        <div class="ig-card">
            <div class="ig-head">
                <img src="icons/icon-192.png" alt="">
                <div><div class="ig-title">安裝到主畫面</div><div class="ig-sub">${content.sub}</div></div>
            </div>
            ${stepsHtml ? `<ul class="ig-steps">${stepsHtml}</ul>` : ''}
            <div class="ig-btns"></div>
        </div>`;
    const btns = overlay.querySelector('.ig-btns');
    const close = () => overlay.remove();

    if (auto) {
        const never = document.createElement('button');
        never.className = 'ig-btn ghost';
        never.textContent = '不再提示';
        never.onclick = () => { try { localStorage.setItem(DISMISS_KEY, 'never'); } catch {} close(); };
        btns.appendChild(never);
    }
    const later = document.createElement('button');
    later.className = 'ig-btn ghost';
    later.textContent = auto ? '稍後再說' : '關閉';
    later.onclick = close;
    btns.appendChild(later);

    if (content.primary === 'install') {
        const install = document.createElement('button');
        install.className = 'ig-btn primary';
        install.textContent = '安裝';
        install.onclick = async () => {
            const prompt = deferredPrompt;
            deferredPrompt = null; // 安裝事件只能用一次
            close();
            if (!prompt) return;
            prompt.prompt();
            try { await prompt.userChoice; } catch {}
        };
        btns.appendChild(install);
    }

    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
    document.body.appendChild(overlay);
}

// 使用者選單的「安裝到主畫面」：手動打開，不受「不再提示」影響
export function openInstallGuide() {
    if (isStandalone()) {
        alert('目前已經是從主畫面打開的 App 模式了');
        return;
    }
    showGuide({ auto: false });
}

// 自動提示：玩完（關閉）第一個任務後呼叫。同一次開啟只提示一次，選過「不再提示」就不再出現。
export function maybeShowInstallGuide() {
    if (isStandalone() || shownThisSession) return;
    try { if (localStorage.getItem(DISMISS_KEY) === 'never') return; } catch {}
    shownThisSession = true;
    setTimeout(() => showGuide({ auto: true }), 800); // 等任務視窗收起、畫面回到大廳再跳出
}

// 已經是 App 模式時，把使用者選單裡的入口藏起來
export function updateMenuEntry() {
    const btn = document.getElementById('menu-install-btn');
    if (btn) btn.style.display = isStandalone() ? 'none' : '';
}
