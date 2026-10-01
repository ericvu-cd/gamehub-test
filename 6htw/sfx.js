// =============================================
// 🎵 友魚守護團 — 完整音效系統 (方案 C)
// =============================================
// 設計原則：
//   1. 單例 AudioContext — 永不重複創建，根本解決音效丟失
//   2. 主 GainNode — 統一音量控制，可淡入淡出
//   3. 音效佇列 — 防止重疊爆音
//   4. 海洋主題 — 每個音效都有水聲、氣泡、共鳴感
//   5. BGM 也接進 Web Audio API — 手機上與音效走同一音訊路由，
//      避免 <audio> 媒體音量 vs Web Audio 鈴聲音量不一致的問題
//
// ⚠️ iOS Safari 音訊解鎖限制：
//   AudioContext 在建立當下預設是 "suspended"（暫停）狀態，iOS Safari
//   規定「一定要在使用者手勢事件（click/touchstart 等）的同步呼叫堆疊內」
//   呼叫 resume() 才能真正解鎖發聲，時間差一點點（例如包在 setTimeout、
//   Promise.then 裡）都可能失敗。日後如果收到「iPhone 沒聲音」的回報，
//   優先檢查：resume() 有沒有確實掛在使用者互動事件的同步呼叫裡。
// =============================================

const SFX = (() => {

    // ── 裝置偵測 ──────────────────────────────────
    const _isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);

    // ── 單例 AudioContext ──────────────────────────
    let _ctx = null;
    let _masterGain = null;

    function getCtx() {
        if (!_ctx) {
            _ctx = new (window.AudioContext || window.webkitAudioContext)();
            _masterGain = _ctx.createGain();
            // 手機喇叭動態範圍窄，音效整體放大以免被 BGM 蓋過
            _masterGain.gain.value = _isMobile ? 1.75 : 0.35;
            _masterGain.connect(_ctx.destination);
        }
        // 瀏覽器自動暫停後恢復（iOS/Chrome 需要使用者互動）
        if (_ctx.state === "suspended") {
            _ctx.resume();
        }
        return _ctx;
    }

    function master() {
        getCtx(); // 確保 _masterGain 已建立
        return _masterGain;
    }

    // ── 工具函式 ──────────────────────────────────

    // 建立振盪器並連到目標節點
    function osc(type, freq, gainVal, endGain, duration, destination, startDelay = 0) {
        const ctx = getCtx();
        const o = ctx.createOscillator();
        const g = ctx.createGain();
        o.type = type;
        o.frequency.setValueAtTime(freq, ctx.currentTime + startDelay);
        g.gain.setValueAtTime(gainVal, ctx.currentTime + startDelay);
        g.gain.exponentialRampToValueAtTime(Math.max(endGain, 0.0001), ctx.currentTime + startDelay + duration);
        o.connect(g);
        g.connect(destination);
        o.start(ctx.currentTime + startDelay);
        o.stop(ctx.currentTime + startDelay + duration + 0.02);
        return { osc: o, gain: g };
    }

    // 建立白雜訊緩衝
    function noise(durationSec, gainVal, endGain, destination, startDelay = 0, bandpassFreq = null) {
        const ctx = getCtx();
        const bufSize = Math.ceil(ctx.sampleRate * (durationSec + 0.05));
        const buf = ctx.createBuffer(1, bufSize, ctx.sampleRate);
        const data = buf.getChannelData(0);
        for (let i = 0; i < bufSize; i++) data[i] = Math.random() * 2 - 1;

        const src = ctx.createBufferSource();
        src.buffer = buf;

        const g = ctx.createGain();
        g.gain.setValueAtTime(gainVal, ctx.currentTime + startDelay);
        g.gain.exponentialRampToValueAtTime(Math.max(endGain, 0.0001), ctx.currentTime + startDelay + durationSec);

        let lastNode = src;
        if (bandpassFreq) {
            const bp = ctx.createBiquadFilter();
            bp.type = "bandpass";
            bp.frequency.value = bandpassFreq;
            bp.Q.value = 1.5;
            src.connect(bp);
            bp.connect(g);
        } else {
            src.connect(g);
        }
        g.connect(destination);
        src.start(ctx.currentTime + startDelay);
        src.stop(ctx.currentTime + startDelay + durationSec + 0.05);
        return { src, gain: g };
    }


    // ── 是否啟用 ──────────────────────────────────
    // 沿用 main.js 的 sfxEnabled 變數
    function enabled() {
        return typeof sfxEnabled === "undefined" || sfxEnabled;
    }

    // =============================================
    // 🃏 card — 出牌音效（玩家）
    // 低頻撞擊 + 短促氣泡聲 + 輕微水聲
    // =============================================
    function card() {
        if (!enabled()) return;
        try {
            const ctx = getCtx();
            const dest = master();

            // 低頻撞擊（牌放上桌）
            const o = ctx.createOscillator();
            const og = ctx.createGain();
            o.type = "triangle";
            o.frequency.setValueAtTime(180, ctx.currentTime);
            o.frequency.exponentialRampToValueAtTime(45, ctx.currentTime + 0.09);
            og.gain.setValueAtTime(1.28, ctx.currentTime);
            og.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.10);
            o.connect(og); og.connect(dest);
            o.start(); o.stop(ctx.currentTime + 0.12);

            // 氣泡感（高頻短噪）
            noise(0.04, 0.53, 0.001, dest, 0, 3500);

            // 尾音（低沉共鳴，像水中回音）
            const o2 = ctx.createOscillator();
            const og2 = ctx.createGain();
            o2.type = "sine";
            o2.frequency.setValueAtTime(90, ctx.currentTime + 0.05);
            og2.gain.setValueAtTime(0.33, ctx.currentTime + 0.05);
            og2.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.35);
            o2.connect(og2); og2.connect(dest);
            o2.start(ctx.currentTime + 0.05);
            o2.stop(ctx.currentTime + 0.38);

        } catch(e) { console.warn("SFX.card error:", e); }
    }

    // =============================================
    // 🤖 cardAI — AI 出牌音效
    // 比玩家稍微沉一點、短一點，有距離感
    // =============================================
    function cardAI() {
        if (!enabled()) return;
        try {
            const ctx = getCtx();
            const dest = master();

            const o = ctx.createOscillator();
            const og = ctx.createGain();
            o.type = "triangle";
            o.frequency.setValueAtTime(130, ctx.currentTime);
            o.frequency.exponentialRampToValueAtTime(38, ctx.currentTime + 0.07);
            og.gain.setValueAtTime(0.98, ctx.currentTime);
            og.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.08);
            o.connect(og); og.connect(dest);
            o.start(); o.stop(ctx.currentTime + 0.10);

            // 微弱水聲尾巴
            noise(0.06, 0.30, 0.001, dest, 0.01, 1800);

        } catch(e) { console.warn("SFX.cardAI error:", e); }
    }

    // =============================================
    // ❌ invalid — 出牌失敗（條件不符）
    // 短促下滑音，像搖頭警告
    // =============================================
    function invalid() {
        if (!enabled()) return;
        try {
            const ctx = getCtx();
            const dest = master();

            // 兩聲短促下滑
            [0, 0.13].forEach(delay => {
                const o = ctx.createOscillator();
                const og = ctx.createGain();
                o.type = "sawtooth";
                o.frequency.setValueAtTime(320, ctx.currentTime + delay);
                o.frequency.exponentialRampToValueAtTime(160, ctx.currentTime + delay + 0.10);
                og.gain.setValueAtTime(0.30, ctx.currentTime + delay);
                og.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + delay + 0.12);
                o.connect(og); og.connect(dest);
                o.start(ctx.currentTime + delay);
                o.stop(ctx.currentTime + delay + 0.14);
            });

        } catch(e) { console.warn("SFX.invalid error:", e); }
    }

    // =============================================
    // 🙏 mazu — 媽祖籤出現
    // 三聲鐘鳴 + 殘響，神聖莊嚴感
    // =============================================
    function mazu() {
        if (!enabled()) return;
        try {
            const ctx = getCtx();

            // 乾聲也接到 master
            const dryGain = ctx.createGain();
            dryGain.gain.value = 0.84;
            dryGain.connect(master());

            // 三聲鐘（比例：1 : 1.5 : 2，模擬銅鐘泛音）
            const bellNotes = [
                { freq: 523.25, delay: 0,    dur: 1.8 },  // C5
                { freq: 659.25, delay: 0.55, dur: 1.5 },  // E5
                { freq: 783.99, delay: 1.05, dur: 1.3 },  // G5
            ];

            bellNotes.forEach(({ freq, delay, dur }) => {
                // 基音（sine）
                const o = ctx.createOscillator();
                const og = ctx.createGain();
                o.type = "sine";
                o.frequency.value = freq;
                og.gain.setValueAtTime(0.34, ctx.currentTime + delay);
                og.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + delay + dur);
                o.connect(og);
                og.connect(dryGain);
                o.start(ctx.currentTime + delay);
                o.stop(ctx.currentTime + delay + dur + 0.1);

                // 泛音（triangle，頻率x2）
                const o2 = ctx.createOscillator();
                const og2 = ctx.createGain();
                o2.type = "triangle";
                o2.frequency.value = freq * 2.76; // 鐘的自然泛音比
                og2.gain.setValueAtTime(0.12, ctx.currentTime + delay);
                og2.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + delay + dur * 0.6);
                o2.connect(og2);
                og2.connect(dryGain);
                o2.start(ctx.currentTime + delay);
                o2.stop(ctx.currentTime + delay + dur * 0.6 + 0.1);

                // 撞擊瞬間短噪（敲擊感）
                noise(0.025, 0.14, 0.001, dryGain, delay, freq * 1.5);
            });

        } catch(e) { console.warn("SFX.mazu error:", e); }
    }

    // =============================================
    // 🎁 gift — 贈牌動畫
    // 輕盈上升音階 + 水滴殘響
    // =============================================
    function gift() {
        if (!enabled()) return;
        try {
            const ctx = getCtx();
            const dryg = ctx.createGain();
            dryg.gain.value = 0.72;
            dryg.connect(master());

            // 輕快上升五音
            const notes = [523.25, 587.33, 659.25, 698.46, 783.99]; // C D E F G
            notes.forEach((freq, i) => {
                const delay = i * 0.08;
                const o = ctx.createOscillator();
                const og = ctx.createGain();
                o.type = "sine";
                o.frequency.value = freq;
                og.gain.setValueAtTime(0.24, ctx.currentTime + delay);
                og.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + delay + 0.28);
                o.connect(og);
                og.connect(dryg);
                o.start(ctx.currentTime + delay);
                o.stop(ctx.currentTime + delay + 0.32);
            });

            // 結尾水滴閃光音
            const sparkFreqs = [1046.5, 1318.5, 1567.98];
            sparkFreqs.forEach((freq, i) => {
                const delay = 0.42 + i * 0.05;
                const o = ctx.createOscillator();
                const og = ctx.createGain();
                o.type = "sine";
                o.frequency.value = freq;
                og.gain.setValueAtTime(0.12, ctx.currentTime + delay);
                og.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + delay + 0.18);
                o.connect(og);
                og.connect(dryg);
                o.start(ctx.currentTime + delay);
                o.stop(ctx.currentTime + delay + 0.22);
            });

        } catch(e) { console.warn("SFX.gift error:", e); }
    }

    // =============================================
    // 📜 draw — 抽到召喚牌
    // 低沉的「swish」聲 + 輕微呼嘯，像從水中撈起
    // =============================================
    function draw() {
        if (!enabled()) return;
        try {
            const ctx = getCtx();
            const dest = master();

            // 上升掃頻（召喚出現感）
            const o = ctx.createOscillator();
            const og = ctx.createGain();
            o.type = "sine";
            o.frequency.setValueAtTime(200, ctx.currentTime);
            o.frequency.exponentialRampToValueAtTime(440, ctx.currentTime + 0.25);
            og.gain.setValueAtTime(0.0, ctx.currentTime);
            og.gain.linearRampToValueAtTime(0.44, ctx.currentTime + 0.08);
            og.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.35);
            o.connect(og); og.connect(dest);
            o.start(); o.stop(ctx.currentTime + 0.38);

            // 寬頻噪音掃過（「嗖」的感覺）
            noise(0.28, 0.24, 0.001, dest, 0, 800);

            // 小氣泡音（水中浮起感）
            [0.18, 0.26].forEach(d => {
                noise(0.04, 0.14, 0.001, dest, d, 3200);
            });

        } catch(e) { console.warn("SFX.draw error:", e); }
    }

    // =============================================
    // ✅ success — 出牌成功結算
    // 水滴音 + 殘響，輕盈清脆，符合海洋主題
    // =============================================
    function success() {
        if (!enabled()) return;
        try {
            const ctx = getCtx();
            const dryg = ctx.createGain();
            dryg.gain.value = 0.78;
            dryg.connect(master());

            // 主音：清脆水滴（兩個音符上行）
            const pairs = [
                { freq: 659.25, delay: 0 },
                { freq: 880.00, delay: 0.12 },
            ];
            pairs.forEach(({ freq, delay }) => {
                const o = ctx.createOscillator();
                const og = ctx.createGain();
                o.type = "sine";
                o.frequency.value = freq;
                og.gain.setValueAtTime(0.31, ctx.currentTime + delay);
                og.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + delay + 0.40);
                o.connect(og);
                og.connect(dryg);
                o.start(ctx.currentTime + delay);
                o.stop(ctx.currentTime + delay + 0.44);
            });

            // 高頻閃光（對比強調）
            const hi = ctx.createOscillator();
            const hig = ctx.createGain();
            hi.type = "triangle";
            hi.frequency.value = 1760;
            hig.gain.setValueAtTime(0.10, ctx.currentTime + 0.20);
            hig.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.45);
            hi.connect(hig); hig.connect(dryg);
            hi.start(ctx.currentTime + 0.20);
            hi.stop(ctx.currentTime + 0.48);

        } catch(e) { console.warn("SFX.success error:", e); }
    }

    // =============================================
    // 🏆 win — 玩家獲勝
    // 歡慶上升音階（Do Re Mi Fa Sol La Ti Do）+ 殘響
    // =============================================
    function win() {
        if (!enabled()) return;
        try {
            const ctx = getCtx();
            const dryg = ctx.createGain();
            dryg.gain.value = 0.84;
            dryg.connect(master());

            // Do Re Mi Fa Sol La Ti Do（C4 ~ C5）
            const scale = [261.63, 293.66, 329.63, 349.23, 392.00, 440.00, 493.88, 523.25];
            scale.forEach((freq, i) => {
                const delay = i * 0.09;
                const isFinal = i === scale.length - 1;

                const o = ctx.createOscillator();
                const og = ctx.createGain();
                o.type = isFinal ? "triangle" : "sine";
                o.frequency.value = freq;
                og.gain.setValueAtTime(isFinal ? 0.46 : 0.26, ctx.currentTime + delay);
                og.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + delay + (isFinal ? 1.5 : 0.22));
                o.connect(og);
                og.connect(dryg);
                o.start(ctx.currentTime + delay);
                o.stop(ctx.currentTime + delay + (isFinal ? 1.8 : 0.28));

                // 和聲（+5度）
                if (isFinal) {
                    const o3 = ctx.createOscillator();
                    const og3 = ctx.createGain();
                    o3.type = "sine";
                    o3.frequency.value = freq * 1.5;
                    og3.gain.setValueAtTime(0.19, ctx.currentTime + delay);
                    og3.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + delay + 1.2);
                    o3.connect(og3); og3.connect(dryg);
                    o3.start(ctx.currentTime + delay);
                    o3.stop(ctx.currentTime + delay + 1.4);
                }
            });

            // 結尾氣泡爆發
            for (let i = 0; i < 6; i++) {
                const d = 0.72 + i * 0.04;
                noise(0.06, 0.07, 0.001, dryg, d, 2000 + i * 400);
            }

        } catch(e) { console.warn("SFX.win error:", e); }
    }

    // =============================================
    // 💔 lose — 玩家落敗
    // 下降半音階 + 低沉共鳴，悲傷但不過分
    // =============================================
    function lose() {
        if (!enabled()) return;
        try {
            const ctx = getCtx();
            const dryg = ctx.createGain();
            dryg.gain.value = 0.72;
            dryg.connect(master());

            // 下降三音（悲傷感）
            const falling = [440.00, 392.00, 349.23, 293.66];
            falling.forEach((freq, i) => {
                const delay = i * 0.18;
                const o = ctx.createOscillator();
                const og = ctx.createGain();
                o.type = "sine";
                o.frequency.value = freq;
                og.gain.setValueAtTime(0.26, ctx.currentTime + delay);
                og.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + delay + 0.5);
                o.connect(og);
                og.connect(dryg);
                o.start(ctx.currentTime + delay);
                o.stop(ctx.currentTime + delay + 0.6);
            });

            // 低沉沉底音（海洋深處感）
            const bass = ctx.createOscillator();
            const bassg = ctx.createGain();
            bass.type = "sine";
            bass.frequency.setValueAtTime(110, ctx.currentTime + 0.5);
            bass.frequency.exponentialRampToValueAtTime(60, ctx.currentTime + 1.8);
            bassg.gain.setValueAtTime(0.22, ctx.currentTime + 0.5);
            bassg.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 2.0);
            bass.connect(bassg); bassg.connect(dryg);
            bass.start(ctx.currentTime + 0.5);
            bass.stop(ctx.currentTime + 2.2);

        } catch(e) { console.warn("SFX.lose error:", e); }
    }

    // ── 對外 API ──────────────────────────────────
    return { card, cardAI, invalid, mazu, gift, draw, success, win, lose, getCtx };

})();





