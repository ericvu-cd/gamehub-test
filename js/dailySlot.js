// =====================================================================
// 每日幸運拉霸（兩位數）
// 當天首次登入時由 main.js 自動開啟。畫面與樣式全部由這個模組自己產生，
// 不需要修改首頁 index.html 或 CSS 檔。
//
// 流程重點：玩家按下「拉霸」→ 先抽出結果並寫入 Firestore（呼叫端傳入的 claim）
// → 寫入成功才播轉盤動畫揭曉。順序不能反過來：如果先轉再寫，玩家看到不滿意的
// 結果時重新整理頁面，就能無限重抽。
// =====================================================================

// ---- 機率設定 ----
// 結果範圍 1 ~ 上限（上限 = 後台「每日拉霸金幣上限」）。
// 「上限的一半以下」每個數字權重 LOW_WEIGHT，「一半以上」每個數字權重 HIGH_WEIGHT。
// 例：上限 10、權重 1 : 3 → 拿到 6 枚以上的機率 75%，平均約 6.75 枚。
// 想調整高低數字的比重，只要改這兩個數字。
const LOW_WEIGHT = 1;
const HIGH_WEIGHT = 3;

const DIGIT_H = 60;
const REEL_COUNT = 2;

function drawAmount(cap) {
    const half = Math.floor(cap / 2);
    const weights = [];
    for (let v = 1; v <= cap; v++) weights.push(v <= half ? LOW_WEIGHT : HIGH_WEIGHT);
    const total = weights.reduce((s, w) => s + w, 0);
    let r = Math.random() * total;
    for (let i = 0; i < weights.length; i++) {
        r -= weights[i];
        if (r < 0) return i + 1;
    }
    return cap; // 浮點數邊界情況的保底值
}

// ---- 樣式（只注入一次，全部用 ds- 前綴，避免跟平台既有樣式互相影響） ----
function injectStyles() {
    if (document.getElementById('ds-style')) return;
    const font = document.createElement('link');
    font.rel = 'stylesheet';
    font.href = 'https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@800&display=swap';
    document.head.appendChild(font);

    const style = document.createElement('style');
    style.id = 'ds-style';
    style.textContent = `
    .ds-overlay { position: fixed; inset: 0; z-index: 9000; background: rgba(8,10,14,0.78);
        display: flex; align-items: center; justify-content: center; padding: 20px; }
    .ds-cabinet { position: relative; width: 100%; max-width: 300px; border-radius: 18px;
        padding: 22px 22px 20px; background: linear-gradient(180deg, #45474e, #34363c);
        box-shadow: 0 20px 50px rgba(0,0,0,0.55), inset 0 1px 0 rgba(255,255,255,0.06);
        text-align: center; color: #f0ebdd; font-family: inherit; }
    .ds-bolt { position: absolute; width: 9px; height: 9px; border-radius: 50%;
        background: radial-gradient(circle at 35% 35%, #e6bd78, #8a6a35); }
    .ds-bolt.tl { top: 10px; left: 10px; } .ds-bolt.tr { top: 10px; right: 10px; }
    .ds-bolt.bl { bottom: 10px; left: 10px; } .ds-bolt.br { bottom: 10px; right: 10px; }
    .ds-title { font-size: 1.05rem; font-weight: 900; color: #e6bd78; letter-spacing: 0.15em; margin-bottom: 4px; }
    .ds-sub { font-size: 0.8rem; color: rgba(240,235,221,0.65); margin-bottom: 14px; }
    .ds-display { display: flex; gap: 10px; justify-content: center; background: #1e1f23;
        padding: 14px; border-radius: 10px; box-shadow: inset 0 2px 10px rgba(0,0,0,0.6); }
    .ds-window { width: 62px; height: ${DIGIT_H}px; background: #26272b; border-radius: 6px;
        overflow: hidden; position: relative; box-shadow: inset 0 0 0 1px rgba(255,255,255,0.03); }
    .ds-window::after { content: ''; position: absolute; top: 50%; left: 0; right: 0; height: 2px;
        background: #0a0a0c; transform: translateY(-1px); z-index: 2; }
    .ds-window::before { content: ''; position: absolute; inset: 0; z-index: 3; pointer-events: none;
        box-shadow: inset 0 10px 14px -8px rgba(0,0,0,0.7), inset 0 -10px 14px -8px rgba(0,0,0,0.7); }
    .ds-strip { position: absolute; top: 0; left: 0; width: 100%; will-change: transform; }
    .ds-digit { height: ${DIGIT_H}px; display: flex; align-items: center; justify-content: center;
        font-family: 'JetBrains Mono', ui-monospace, monospace; font-weight: 800; font-size: 46px; color: #f0ebdd; }
    .ds-unit { margin-top: 8px; font-size: 0.8rem; color: rgba(240,235,221,0.65); }
    .ds-msg { min-height: 1.6em; margin: 12px 0 10px; font-size: 0.95rem; font-weight: 700; color: #e6bd78; }
    .ds-msg.error { color: #ff9c8a; }
    .ds-btn { font-weight: 800; font-size: 15px; letter-spacing: 0.08em; padding: 11px 34px;
        border-radius: 999px; border: none; cursor: pointer; color: #241a08;
        background: linear-gradient(180deg, #e6bd78, #8a6a35);
        box-shadow: 0 3px 0 #5f471f, 0 8px 16px rgba(0,0,0,0.4); font-family: inherit; }
    .ds-btn:active:not(:disabled) { transform: translateY(3px); box-shadow: 0 0 0 #5f471f, 0 4px 10px rgba(0,0,0,0.4); }
    .ds-btn:disabled { background: #4c4d52; color: #8a8b90; cursor: default; box-shadow: 0 3px 0 #303135; }
    .ds-later { display: block; margin: 10px auto 0; background: none; border: none; cursor: pointer;
        font-size: 0.75rem; color: rgba(240,235,221,0.5); text-decoration: underline; font-family: inherit; }
    .ds-cabinet.ds-win { animation: dsWin 0.6s ease; }
    @keyframes dsWin { 0% { transform: scale(1); } 40% { transform: scale(1.05); } 100% { transform: scale(1); } }
    `;
    document.head.appendChild(style);
}

// ---- 音效（即時合成，不需要外部音檔；拉霸按鈕本身就是使用者操作，可以解鎖音訊） ----
let audioCtx = null;
function ensureAudio() {
    try {
        if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        if (audioCtx.state === 'suspended') audioCtx.resume();
    } catch { audioCtx = null; }
}
function playTick() {
    if (!audioCtx) return;
    const t = audioCtx.currentTime;
    const osc = audioCtx.createOscillator();
    const filter = audioCtx.createBiquadFilter();
    const gain = audioCtx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(520, t);
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(1400, t);
    gain.gain.setValueAtTime(0.045, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.05);
    osc.connect(filter); filter.connect(gain); gain.connect(audioCtx.destination);
    osc.start(t); osc.stop(t + 0.055);
}
function playWin() {
    if (!audioCtx) return;
    const t0 = audioCtx.currentTime;
    [523.25, 659.25, 784.0, 1046.5].forEach((f, i) => {
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        const st = t0 + i * 0.1;
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(f, st);
        gain.gain.setValueAtTime(0.0001, st);
        gain.gain.exponentialRampToValueAtTime(0.18, st + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, st + 0.35);
        osc.connect(gain); gain.connect(audioCtx.destination);
        osc.start(st); osc.stop(st + 0.4);
    });
}

// 前段全速捲動，後段拉長、慢慢爬向終點（沿用 slot10 的手感）
function easeOutSlow(t) {
    const cruiseT = 0.42, cruiseD = 0.68;
    if (t <= cruiseT) return (t / cruiseT) * cruiseD;
    const t2 = (t - cruiseT) / (1 - cruiseT);
    return cruiseD + (1 - Math.pow(1 - t2, 5)) * (1 - cruiseD);
}

function animateReel(strip, finalDigit, extraLoops, duration, delay) {
    return new Promise(resolve => {
        setTimeout(() => {
            const targetIndex = extraLoops * 10 + finalDigit;
            while (strip.children.length <= targetIndex) {
                const d = document.createElement('div');
                d.className = 'ds-digit';
                d.textContent = strip.children.length % 10;
                strip.appendChild(d);
            }
            const targetY = -targetIndex * DIGIT_H;
            const t0 = performance.now();
            let lastTick = 0;
            function step(now) {
                const p = Math.min((now - t0) / duration, 1);
                const y = targetY * easeOutSlow(p);
                strip.style.transform = `translateY(${y}px)`;
                const idx = Math.floor(-y / DIGIT_H);
                if (idx !== lastTick) { lastTick = idx; playTick(); }
                if (p < 1) requestAnimationFrame(step);
                else { strip.style.transform = `translateY(${targetY}px)`; resolve(); }
            }
            requestAnimationFrame(step);
        }, delay);
    });
}

/**
 * 開啟每日拉霸視窗。
 * @param {object}   opts
 * @param {number}   opts.cap    結果上限（1~50，呼叫端負責夾好範圍）
 * @param {function} opts.claim  async (amount) => { ok, alreadyClaimed?, reason? }
 *                               負責把金額寫進 Firestore，寫入成功才會播動畫揭曉
 * @returns {Promise<void>} 視窗關閉時 resolve（揭曉結果後 2 秒自動關閉）
 */
export function openDailySlot({ cap, claim }) {
    injectStyles();
    return new Promise(resolve => {
        const overlay = document.createElement('div');
        overlay.className = 'ds-overlay';
        overlay.innerHTML = `
            <div class="ds-cabinet">
                <span class="ds-bolt tl"></span><span class="ds-bolt tr"></span>
                <span class="ds-bolt bl"></span><span class="ds-bolt br"></span>
                <div class="ds-title">每日幸運拉霸</div>
                <div class="ds-sub">今日最高可得 ${cap} 枚通行金幣</div>
                <div class="ds-display">
                    <div class="ds-window"><div class="ds-strip"></div></div>
                    <div class="ds-window"><div class="ds-strip"></div></div>
                </div>
                <div class="ds-unit">通行金幣</div>
                <div class="ds-msg"></div>
                <button class="ds-btn" type="button">拉霸！</button>
                <button class="ds-later" type="button">稍後再說</button>
            </div>`;
        document.body.appendChild(overlay);

        const cabinet = overlay.querySelector('.ds-cabinet');
        const strips = [...overlay.querySelectorAll('.ds-strip')];
        const msgEl = overlay.querySelector('.ds-msg');
        const btn = overlay.querySelector('.ds-btn');
        const laterBtn = overlay.querySelector('.ds-later');

        // 初始畫面顯示 00，並先建立足夠的數字方塊
        strips.forEach(strip => {
            for (let i = 0; i < 120; i++) {
                const d = document.createElement('div');
                d.className = 'ds-digit';
                d.textContent = i % 10;
                strip.appendChild(d);
            }
        });

        let stage = 'ready'; // ready → claiming → spinning → done（done 之後 2 秒自動關閉）
        function close() { overlay.remove(); resolve(); }

        // 「稍後再說」：不領取直接關閉，下次登入／重新整理會再跳出來。
        // 保留這個出口，是為了網路一直失敗時玩家不會被卡在視窗裡無法使用平台。
        laterBtn.addEventListener('click', () => {
            if (stage === 'ready') close();
        });

        btn.addEventListener('click', async () => {
            if (stage !== 'ready') return;
            ensureAudio();
            stage = 'claiming';
            btn.disabled = true;
            btn.textContent = '連線中…';
            laterBtn.style.display = 'none';
            msgEl.classList.remove('error');
            msgEl.textContent = '';

            const amount = drawAmount(cap);
            let result;
            try { result = await claim(amount); }
            catch (err) { result = { ok: false, reason: err?.message }; }

            if (result && result.ok && result.alreadyClaimed) {
                stage = 'done';
                msgEl.textContent = '今天已經在其他裝置領過囉！';
                btn.style.display = 'none';
                setTimeout(close, 2000);
                return;
            }
            if (!result || !result.ok) {
                // 寫入失敗＝什麼都沒發生，讓玩家重按一次（重按會重新抽，
                // 但因為前一次根本沒有寫入成功，不算重抽漏洞）
                stage = 'ready';
                msgEl.classList.add('error');
                msgEl.textContent = '連線失敗，請再按一次';
                btn.disabled = false;
                btn.textContent = '拉霸！';
                laterBtn.style.display = '';
                return;
            }

            // 已經寫入成功，開始播動畫揭曉結果
            stage = 'spinning';
            btn.textContent = '轉動中…';
            const digits = [Math.floor(amount / 10), amount % 10];
            await Promise.all(digits.map((d, i) =>
                animateReel(strips[i], d, 7 + i * 2, 3000 + i * 1400, i * 300)
            ));

            stage = 'done';
            playWin();
            cabinet.classList.add('ds-win');
            msgEl.textContent = `🎉 獲得 ${amount} 枚通行金幣！`;
            btn.style.display = 'none';
            setTimeout(close, 2000); // 揭曉後停留2秒讓玩家看清楚結果，自動收下關閉，不用再按按鈕
        });
    });
}
