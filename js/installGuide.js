// 安裝到主畫面引導
// 安裝成功後：先嘗試關閉瀏覽器頁面；若瀏覽器禁止自動關閉，
// 就以全頁完成畫面鎖住網頁，引導玩家回主畫面從 App 圖示重新開啟。

const DISMISS_KEY = 'gh_install_guide_dismissed';
let deferredPrompt = null;
let installedResolvers = [];
let startupPromise = null;

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
    return window.matchMedia('(display-mode: standalone)').matches ||
        window.navigator.standalone === true;
}

function detectEnv() {
    const ua = navigator.userAgent || '';
    const isIPad = /iPad/.test(ua) ||
        (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    const isIOS = /iPhone|iPad|iPod/.test(ua) || isIPad;
    const inApp = /FBAN|FBAV|FB_IAB|Instagram|Line\/|Messenger|MicroMessenger|KAKAOTALK|Twitter/i.test(ua);
    return { isIOS, isIPad, inApp };
}

function injectStyles() {
    if (document.getElementById('ig-style')) return;
    const style = document.createElement('style');
    style.id = 'ig-style';
    style.textContent = `
    .ig-overlay{position:fixed;inset:0;z-index:600;background:rgba(6,10,28,.78);display:flex;align-items:center;justify-content:center;padding:16px}
    .ig-card{width:100%;max-width:380px;background:#151d52;color:#fff;border-radius:18px;padding:22px 20px 18px;box-shadow:0 10px 40px rgba(0,0,0,.45);border:1px solid rgba(255,255,255,.14);font-family:inherit}
    .ig-head{display:flex;align-items:center;gap:12px;margin-bottom:12px}
    .ig-head img{width:52px;height:52px;border-radius:12px;flex:0 0 auto}
    .ig-title{font-size:1.1rem;font-weight:900}.ig-sub{font-size:.82rem;color:rgba(255,255,255,.7);margin-top:2px;line-height:1.5}
    .ig-steps{margin:6px 0 12px;padding:0;list-style:none;font-size:.92rem;line-height:1.6}
    .ig-steps li{display:flex;align-items:center;gap:8px;padding:5px 0}
    .ig-num{flex:0 0 auto;width:22px;height:22px;border-radius:50%;background:#f6b32d;color:#1a1a1a;font-size:.75rem;font-weight:900;display:flex;align-items:center;justify-content:center}
    .ig-icon{display:inline-flex;vertical-align:middle}.ig-note{font-size:.78rem;color:rgba(255,255,255,.6);margin:0 0 12px;line-height:1.5}
    .ig-status{display:flex;flex-direction:column;align-items:center;gap:12px;padding:14px 0 6px;font-size:.95rem;font-weight:700;text-align:center;line-height:1.6}
    .ig-spinner{width:36px;height:36px;border-radius:50%;border:4px solid rgba(255,255,255,.18);border-top-color:#f6b32d;animation:igSpin .9s linear infinite}
    @keyframes igSpin{to{transform:rotate(360deg)}}.ig-btns{display:flex;gap:8px}
    .ig-btn{flex:1;padding:11px 8px;border-radius:12px;border:none;font-weight:800;font-size:.9rem;cursor:pointer;font-family:inherit}
    .ig-btn.primary{background:linear-gradient(135deg,#ffe37a,#f6b32d);color:#3a2a00}.ig-btn.ghost{background:rgba(255,255,255,.12);color:#fff}

    .ig-installed-screen{position:fixed;inset:0;z-index:99999;background:#0c1230;color:#fff;display:flex;align-items:center;justify-content:center;padding:28px;text-align:center;font-family:inherit}
    .ig-installed-box{width:100%;max-width:390px}
    .ig-installed-icon{width:78px;height:78px;margin:0 auto 20px;border-radius:50%;display:flex;align-items:center;justify-content:center;background:linear-gradient(180deg,#ffe37a,#f6b32d);color:#3a2a00;font-size:42px;font-weight:900}
    .ig-installed-title{font-size:25px;font-weight:900;margin-bottom:12px}
    .ig-installed-text{font-size:16px;line-height:1.8;color:rgba(255,255,255,.82)}
    .ig-installed-app{color:#ffe37a;font-weight:900}
    `;
    document.head.appendChild(style);
}

const SHARE_ICON = `<svg class="ig-icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#7fb8ff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v12"/><path d="M8 7l4-4 4 4"/><path d="M5 12v7a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-7"/></svg>`;
const ADD_ICON = `<svg class="ig-icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round"><rect x="4" y="4" width="16" height="16" rx="4"/><path d="M12 8v8M8 12h8"/></svg>`;

function buildContent({ isIOS, isIPad, inApp }) {
    if (inApp) return {
        sub: '目前在 App 內建的瀏覽器中，無法安裝',
        steps: ['點右上角的選單（「⋯」或「⋮」）',
            isIOS ? '選「在 Safari 中開啟」' : '選「在瀏覽器中開啟」或「以 Chrome 開啟」',
            '在 Safari／Chrome 打開後，就會看到安裝說明'],
        note: '', primary: null
    };
    if (deferredPrompt) return {
        sub: '安裝到主畫面，像 App 一樣全螢幕使用，讀取也更快',
        steps: [], note: '', primary: 'install'
    };
    if (isIOS) return {
        sub: '安裝到主畫面，像 App 一樣全螢幕使用，讀取也更快',
        steps: [
            `點瀏覽器的分享按鈕 ${SHARE_ICON}（${isIPad ? 'Safari、Chrome 都在畫面上方工具列右側' : 'Safari 在畫面下方，Chrome 在網址列右側'}）`,
            `往下找到並點選「加入主畫面」${ADD_ICON}`,
            '按右上角「新增」，再到主畫面點「在地文化平台」圖示打開'
        ],
        note: '提醒：iPhone 的主畫面 App 跟瀏覽器是分開的，第一次從主畫面打開時需要再登入一次。',
        primary: null
    };
    return {
        sub: '安裝到主畫面，像 App 一樣全螢幕使用，讀取也更快',
        steps: ['點瀏覽器右上角的選單「⋮」','選「安裝應用程式」或「加到主畫面」','確認後，到主畫面點「在地文化平台」圖示打開'],
        note: '如果已經安裝過，請直接從主畫面的圖示打開。',
        primary: null
    };
}

function showInstalledAndLeaveWeb() {
    injectStyles();

    // 先將網頁版整個鎖成完成提示，避免玩家繼續操作平台。
    document.querySelectorAll('.ig-overlay').forEach(el => el.remove());
    const screen = document.createElement('div');
    screen.className = 'ig-installed-screen';
    screen.innerHTML = `
        <div class="ig-installed-box">
            <div class="ig-installed-icon">✓</div>
            <div class="ig-installed-title">安裝完成</div>
            <div class="ig-installed-text">
                「在地文化知識型互動平台」已安裝到主畫面。<br><br>
                請關閉此瀏覽器頁面，回到手機主畫面，<br>
                點 <span class="ig-installed-app">「在地文化平台」</span> 圖示重新開啟。
            </div>
        </div>`;
    document.body.appendChild(screen);
    document.documentElement.style.overflow = 'hidden';
    document.body.style.overflow = 'hidden';

    // 瀏覽器只有在允許的情況下才會真的關閉；不允許時就保留上面的全頁提示。
    try {
        window.open('', '_self');
        window.close();
    } catch {}
}

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
            const stepsHtml = content.steps.map((s,i)=>`<li><span class="ig-num">${i+1}</span><span>${s}</span></li>`).join('');
            card.innerHTML = `<div class="ig-head"><img src="icons/icon-192-edu-v1.png" alt=""><div><div class="ig-title">安裝到主畫面</div><div class="ig-sub">${content.sub}</div></div></div>
                ${stepsHtml ? `<ul class="ig-steps">${stepsHtml}</ul>` : ''}
                ${content.note ? `<p class="ig-note">${content.note}</p>` : ''}<div class="ig-btns"></div>`;
            const btns = card.querySelector('.ig-btns');
            // 自動安裝引導不提供略過選項；玩家必須完成安裝。
            // 從使用者選單手動開啟時，仍保留「關閉」，避免選單視窗無法退出。
            if (!auto) addBtn(btns,'關閉','ghost',close);
            if (content.primary === 'install') addBtn(btns,'安裝','primary',startInstall);
        }

        function renderStatus(html,{spinner,buttons}={}) {
            card.innerHTML = `<div class="ig-head"><img src="icons/icon-192-edu-v1.png" alt=""><div><div class="ig-title">安裝到主畫面</div></div></div>
                <div class="ig-status">${spinner?'<div class="ig-spinner"></div>':''}<div>${html}</div></div><div class="ig-btns"></div>`;
            const btns=card.querySelector('.ig-btns');
            (buttons||[]).forEach(b=>addBtn(btns,b.text,b.style,b.onClick));
        }

        async function startInstall() {
            const prompt=deferredPrompt;
            deferredPrompt=null;
            if(!prompt){renderGuide();return;}
            renderStatus('請在跳出的視窗中按「安裝」',{spinner:true});
            prompt.prompt();
            let choice=null;
            try{choice=await prompt.userChoice}catch{}
            if(!choice || choice.outcome!=='accepted'){
                // 系統安裝視窗被取消後，回到安裝引導；不提供略過平台安裝的入口。
                Object.assign(content,buildContent(env));
                renderGuide();
                return;
            }
            renderStatus('安裝中，請稍候…',{spinner:true});
            const done=await new Promise(res=>{
                installedResolvers.push(res);
                setTimeout(()=>res(false),20000);
            });

            // appinstalled 已確認，或瀏覽器 20 秒內未回報但使用者已接受安裝：
            // 都不再讓玩家停留操作網頁版。
            if(done){
                showInstalledAndLeaveWeb();
            }else{
                renderStatus('✅ 安裝應已完成<br>請確認主畫面已有「在地文化平台」圖示。<br>若已出現，請關閉此頁並從主畫面重新開啟。',{
                    spinner:false
                });
            }
        }

        if(waitForPrompt && !deferredPrompt && !env.isIOS && !env.inApp){
            renderStatus('準備安裝…',{spinner:true});
            const start=Date.now();
            const timer=setInterval(()=>{
                if(deferredPrompt || Date.now()-start>3000){
                    clearInterval(timer);
                    Object.assign(content,buildContent(env));
                    renderGuide();
                }
            },200);
        }else renderGuide();

        document.body.appendChild(overlay);
    });
}

function addBtn(container,text,style,onClick){
    const b=document.createElement('button');
    b.className='ig-btn '+style;
    b.textContent=text;
    b.onclick=onClick;
    container.appendChild(b);
}

export function runStartupInstallCheck(){
    if(startupPromise)return startupPromise;
    startupPromise=(async()=>{
        if(isStandalone())return;
        if(window.self!==window.top)return;
        try{if(localStorage.getItem(DISMISS_KEY)==='never')return}catch{}
        await showGuide({auto:true,waitForPrompt:true});
    })();
    return startupPromise;
}

export function openInstallGuide(){
    if(isStandalone()){
        alert('目前已經是從主畫面打開的 App 模式了');
        return;
    }
    showGuide({auto:false});
}

export function updateMenuEntry(){
    const btn=document.getElementById('menu-install-btn');
    if(btn)btn.style.display=isStandalone()?'none':'';
}
