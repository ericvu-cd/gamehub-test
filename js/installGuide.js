// =====================================================================
// 安裝到主畫面的引導（平台一打開就立刻顯示，不等載入或登入）
// - 已經是從主畫面 App 打開的：完全不顯示
// - Android（Chrome 等）：點「安裝」跳出系統安裝視窗，接受後顯示「安裝中…」，
//   安裝完成顯示「安裝完成，請從主畫面圖示打開」
// - iPhone／iPad：蘋果不允許網頁自己安裝，也無法得知安裝進度，只能圖文教學
// - LINE、Facebook 等 App 內建瀏覽器：在裡面無法安裝，提示改用 Safari／Chrome 開啟
// - 桌機展示模式（平台被 platform-desktop.html 包在框架裡）：不顯示
// 玩家選「暫不安裝」下次開啟還會再提示；選「不再提示」就不再自動出現，
// 但使用者選單的「安裝到主畫面」入口一直都在。
// =====================================================================

const DISMISS_KEY = 'gh_install_guide_dismissed'; // 'never'＝不再自動提示
let deferredPrompt = null;
let installedResolvers = [];
let startupPromise = null;

// 越早掛越好：瀏覽器判斷可安裝時會發出這個事件，先攔下來，等玩家按按鈕才真正跳出
window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;
});
window.addEventListener('appinstalled', () => {
    deferredPrompt = null;
    installedResolvers.forEach(fn => fn(true));
    installedResolvers = [];
    updateMenuEntry();
});

export function isStandalone() {
    return window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
}

function detectEnv() {
    const ua = navigator.userAgent || '';
    const isIPad = /iPad/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    const isIOS = /iPhone|iPad|iPod/.test(ua) || isIPad;
    const inApp = /FBAN|FBAV|FB_IAB|Instagram|Line\/|Messenger|MicroMessenger|KAKAOTALK|Twitter/i.test(ua);
    return { isIOS, isIPad, inApp };
}

function injectStyles() {
    if (document.getElementById('ig-style')) return;
    const style = document.createElement('style');
    style.id = 'ig-style';
    style.textContent = `
    .ig-overlay { position: fixed; inset: 0; z-index: 600; background: rgba(6,10,28,0.78);
        display: flex; align-items: center; justify-content: center; padding: 16px; }
    .ig-card { width: 100%; max-width: 380px; background: #151d52; color: #fff; border-radius: 18px;
        padding: 22px 20px 18px; box-shadow: 0 10px 40px rgba(0,0,0,0.45);
        border: 1px solid rgba(255,255,255,0.14); font-family: inherit; }
    .ig-head { display: flex; align-items: center; gap: 12px; margin-bottom: 12px; }
    .ig-head img { width: 52px; height: 52px; border-radius: 12px; flex: 0 0 auto; }
    .ig-title { font-size: 1.1rem; font-weight: 900; }
    .ig-sub { font-size: 0.82rem; color: rgba(255,255,255,0.7); margin-top: 2px; line-height: 1.5; }
    .ig-steps { margin: 6px 0 12px; padding: 0; list-style: none; font-size: 0.92rem; line-height: 1.6; }
    .ig-steps li { display: flex; align-items: center; gap: 8px; padding: 5px 0; }
    .ig-num { flex: 0 0 auto; width: 22px; height: 22px; border-radius: 50%; background: #f6b32d; color: #1a1a1a;
        font-size: 0.75rem; font-weight: 900; display: flex; align-items: center; justify-content: center; }
    .ig-icon { display: inline-flex; vertical-align: middle; }
    .ig-note { font-size: 0.78rem; color: rgba(255,255,255,0.6); margin: 0 0 12px; line-height: 1.5; }
    .ig-status { display: flex; flex-direction: column; align-items: center; gap: 12px; padding: 14px 0 6px;
        font-size: 0.95rem; font-weight: 700; text-align: center; line-height: 1.6; }
    .ig-spinner { width: 36px; height: 36px; border-radius: 50%; border: 4px solid rgba(255,255,255,0.18);
        border-top-color: #f6b32d; animation: igSpin 0.9s linear infinite; }
    @keyframes igSpin { to { transform: rotate(360deg); } }
    .ig-btns { display: flex; gap: 8px; }
    .ig-btn { flex: 1; padding: 11px 8px; border-radius: 12px; border: none; font-weight: 800; font-size: 0.9rem;
        cursor: pointer; font-family: inherit; }
    .ig-btn.primary { background: linear-gradient(135deg, #ffe37a, #f6b32d); color: #3a2a00; }
    .ig-btn.ghost { background: rgba(255,255,255,0.12); color: #fff; }
    `;
    document.head.appendChild(style);
}

const SHARE_ICON = `<svg class="ig-icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#7fb8ff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v12"/><path d="M8 7l4-4 4 4"/><path d="M5 12v7a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-7"/></svg>`;
const ADD_ICON = `<svg class="ig-icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round"><rect x="4" y="4" width="16" height="16" rx="4"/><path d="M12 8v8M8 12h8"/></svg>`;

function buildContent({ isIOS, isIPad, inApp }) {
    if (inApp) {
        return {
            sub: '目前在 App 內建的瀏覽器中，無法安裝',
            steps: [
                '點右上角的選單（「⋯」或「⋮」）',
                isIOS ? '選「在 Safari 中開啟」' : '選「在瀏覽器中開啟」或「以 Chrome 開啟」',
                '在 Safari／Chrome 打開後，就會看到安裝說明'
            ],
            note: '',
            primary: null
        };
    }
    if (deferredPrompt) {
        return { sub: '安裝到主畫面，像 App 一樣全螢幕使用，讀取也更快', steps: [], note: '', primary: 'install' };
    }
    if (isIOS) {
        return {
            sub: '安裝到主畫面，像 App 一樣全螢幕使用，讀取也更快',
            steps: [
                `點瀏覽器的分享按鈕 ${SHARE_ICON}（${isIPad ? 'Safari、Chrome 都在畫面上方工具列右側' : 'Safari 在畫面下方，Chrome 在網址列右側'}）`,
                `往下找到並點選「加入主畫面」${ADD_ICON}`,
                '按右上角「新增」，再到主畫面點「在地文化平台」圖示打開'
            ],
            note: '提醒：iPhone 的主畫面 App 跟瀏覽器是分開的，第一次從主畫面打開時需要再登入一次。',
            primary: null
        };
    }
    return {
        sub: '安裝到主畫面，像 App 一樣全螢幕使用，讀取也更快',
        steps: [
            '點瀏覽器右上角的選單「⋮」',
            '選「安裝應用程式」或「加到主畫面」',
            '確認後，到主畫面點「在地文化平台」圖示打開'
        ],
        note: '如果已經安裝過，請直接從主畫面的圖示打開。',
        primary: null
    };
}

// 顯示引導視窗，關閉時 resolve。auto＝平台開啟時自動跳出（多一個「不再提示」）
function showGuide({ auto, waitForPrompt }) {
    return new Promise(resolve => {
        if (document.querySelector('.ig-overlay')) { resolve(); return; }
        injectStyles();
        const env = detectEnv();
        const content = buildContent(env);

        const overlay = document.createElement('div');
        overlay.className = 'ig-overlay';
        overlay.innerHTML = `<div class="ig-card"></div>`;
        const card = overlay.querySelector('.ig-card');
        const close = () => { overlay.remove(); resolve(); };

        function renderGuide() {
            const stepsHtml = content.steps.map((s, i) => `<li><span class="ig-num">${i + 1}</span><span>${s}</span></li>`).join('');
            card.innerHTML = `
                <div class="ig-head">
                    <img src="icons/icon-192.png" alt="">
                    <div><div class="ig-title">安裝到主畫面</div><div class="ig-sub">${content.sub}</div></div>
                </div>
                ${stepsHtml ? `<ul class="ig-steps">${stepsHtml}</ul>` : ''}
                ${content.note ? `<p class="ig-note">${content.note}</p>` : ''}
                <div class="ig-btns"></div>`;
            const btns = card.querySelector('.ig-btns');

            if (auto) addBtn(btns, '不再提示', 'ghost', () => {
                try { localStorage.setItem(DISMISS_KEY, 'never'); } catch {}
                close();
            });
            addBtn(btns, auto ? '暫不安裝' : '關閉', 'ghost', close);
            if (content.primary === 'install') addBtn(btns, '安裝', 'primary', startInstall);
        }

        function renderStatus(html, { spinner, buttons }) {
            card.innerHTML = `
                <div class="ig-head">
                    <img src="icons/icon-192.png" alt="">
                    <div><div class="ig-title">安裝到主畫面</div></div>
                </div>
                <div class="ig-status">${spinner ? '<div class="ig-spinner"></div>' : ''}<div>${html}</div></div>
                <div class="ig-btns"></div>`;
            const btns = card.querySelector('.ig-btns');
            (buttons || []).forEach(b => addBtn(btns, b.text, b.style, b.onClick));
        }

        // Android：跳出系統安裝視窗 → 安裝中 → 安裝完成
        async function startInstall() {
            const prompt = deferredPrompt;
            deferredPrompt = null; // 安裝事件只能用一次
            if (!prompt) { renderGuide(); return; }
            renderStatus('請在跳出的視窗中按「安裝」', { spinner: true });
            prompt.prompt();
            let choice = null;
            try { choice = await prompt.userChoice; } catch {}
            if (!choice || choice.outcome !== 'accepted') {
                renderStatus('已取消安裝，之後可以從選單的「安裝到主畫面」再安裝', {
                    spinner: false, buttons: [{ text: '關閉', style: 'ghost', onClick: close }]
                });
                return;
            }
            renderStatus('安裝中，請稍候…', { spinner: true });
            // 等瀏覽器回報安裝完成（appinstalled）；一段時間沒回報也當作完成，
            // 有些瀏覽器安裝好了但不會發出這個事件
            const done = await new Promise(res => {
                installedResolvers.push(res);
                setTimeout(() => res(false), 20000);
            });
            // 安裝完成就到此為止：已經裝好的人應該從主畫面 App 使用，不再提供回到網頁版的選項
            renderStatus(
                (done ? '✅ 安裝完成！' : '✅ 安裝應已完成') +
                '<br>請回到主畫面，點「在地文化平台」圖示開啟',
                { spinner: false }
            );
        }

        // Android（非 iPhone、非 App 內建瀏覽器）剛開頁面時，瀏覽器的安裝事件可能還沒發出：
        // 先顯示「準備安裝…」，事件一出現就換成有「安裝」按鈕的畫面；最多等 3 秒，
        // 等不到（例如瀏覽器不支援一鍵安裝、或其實已經安裝過）就改顯示手動步驟。
        if (waitForPrompt && !deferredPrompt && !env.isIOS && !env.inApp) {
            renderStatus('準備安裝…', { spinner: true });
            const start = Date.now();
            const timer = setInterval(() => {
                if (deferredPrompt || Date.now() - start > 3000) {
                    clearInterval(timer);
                    Object.assign(content, buildContent(env));
                    renderGuide();
                }
            }, 200);
        } else {
            renderGuide();
        }
        document.body.appendChild(overlay);
    });
}

function addBtn(container, text, style, onClick) {
    const b = document.createElement('button');
    b.className = 'ig-btn ' + style;
    b.textContent = text;
    b.onclick = onClick;
    container.appendChild(b);
}

// 平台一開啟就呼叫（不等內容載入或登入）：沒有安裝就立刻顯示安裝畫面。
// 回傳的 Promise 在安裝畫面關閉（或不需要顯示）時完成，呼叫端等它完成才進行每日拉霸。
// 安裝完成的人畫面不會關閉，所以不會在網頁版跳出拉霸，要到主畫面 App 裡使用。
// 同一次開啟只會檢查一次。
export function runStartupInstallCheck() {
    if (startupPromise) return startupPromise;
    startupPromise = (async () => {
        if (isStandalone()) return;                       // 已經是 App 模式
        if (window.self !== window.top) return;           // 桌機展示模式（被外框包住），不在這裡安裝
        try { if (localStorage.getItem(DISMISS_KEY) === 'never') return; } catch {}
        await showGuide({ auto: true, waitForPrompt: true });
    })();
    return startupPromise;
}

// 使用者選單的「安裝到主畫面」：手動打開，不受「不再提示」影響
export function openInstallGuide() {
    if (isStandalone()) {
        alert('目前已經是從主畫面打開的 App 模式了');
        return;
    }
    showGuide({ auto: false });
}

// 已經是 App 模式時，把使用者選單裡的入口藏起來
export function updateMenuEntry() {
    const btn = document.getElementById('menu-install-btn');
    if (btn) btn.style.display = isStandalone() ? 'none' : '';
}
