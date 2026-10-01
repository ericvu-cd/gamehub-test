/* ════════════════════════════════════════════════════
   intro.js  —  開場動畫（CSS 注入 + 完整邏輯）
   ════════════════════════════════════════════════════ */

/* ── 動態注入 intro 相關 CSS ── */
(function () {
  var style = document.createElement('style');
  style.textContent = `
    #intro-screen {
      position: fixed !important;
      top: 0 !important; left: 0 !important;
      width: 100% !important; height: 100% !important;
      z-index: 99999 !important;
      background: #000 !important;
      overflow: hidden !important;
      cursor: pointer;
      font-family: 'Noto Serif TC', Georgia, serif;
    }
    #intro-vig {
      position: absolute; inset: 0; z-index: 9; pointer-events: none;
      background: radial-gradient(ellipse at center,
        transparent 50%, rgba(0,0,0,.70) 100%);
    }
    #intro-blk {
      position: absolute; inset: 0; background: #000;
      z-index: 8; opacity: 0; pointer-events: none;
      transition: opacity 1.1s cubic-bezier(.4,0,.2,1);
    }
    #intro-scan {
      position: absolute; inset: 0; z-index: 11; pointer-events: none;
      background: linear-gradient(to bottom,
        transparent 0%,
        rgba(255,255,255,.02) 46%,
        rgba(255,255,255,.08) 50%,
        rgba(255,255,255,.02) 54%,
        transparent 100%);
      opacity: 0; transform: translateY(-100%);
    }
    #intro-scan.sweep {
      animation: iSweep 1.1s cubic-bezier(.4,0,.6,1) forwards;
    }
    @keyframes iSweep {
      0%   { opacity:0; transform:translateY(-100%); }
      25%  { opacity:1; }
      100% { opacity:0; transform:translateY(210%); }
    }
    #intro-ts {
      position: absolute; inset: 0;
      display: flex; flex-direction: column; align-items: center; justify-content: center;
      z-index: 5;
    }
    #intro-logo {
      max-width: min(82vw, 720px);
      width: 100%;
      height: auto;
      opacity: 0;
      transform: scale(.94);
      filter: drop-shadow(0 0 28px rgba(80,170,255,.45));
      transition: opacity 1.1s cubic-bezier(.4,0,.2,1), transform 1.1s cubic-bezier(.22,.61,.36,1);
    }
    #intro-logo.show {
      opacity: 1;
      transform: scale(1);
      animation: iLogoPulse 3s ease-in-out 1.1s infinite;
    }
    @keyframes iLogoPulse {
      0%,100%{ filter: drop-shadow(0 0 28px rgba(80,170,255,.45)); }
      50%    { filter: drop-shadow(0 0 46px rgba(80,170,255,.7)); }
    }
    #intro-hint {
      margin-top: 1.3em;
      font-size: clamp(1.1rem, 3vw, 1.4rem);
      letter-spacing: .28em; white-space: nowrap;
      color: rgba(140,140,140,0);
      transition: color 1.4s ease;
      animation: iHint 3s ease-in-out infinite;
      z-index: 20;
    }
    #intro-hint.show { color: rgba(138,138,138,.82); }
    @keyframes iHint { 0%{opacity:.15} 20%{opacity:1} 80%{opacity:.95} 100%{opacity:.15} }
    #intro-credits {
      position: absolute;
      bottom: 28px; left: 0; right: 0;
      text-align: center; z-index: 20;
      font-size: clamp(.8rem, 1.8vw, .95rem);
      letter-spacing: .3em;
      color: rgba(180,210,255,0.75);
      font-family: 'Georgia', serif;
      pointer-events: none;
      opacity: 0; transition: opacity 2s;
    }
    #intro-cs {
      position: absolute; inset: 0; z-index: 4; display: none;
    }
    .iimg {
      position: absolute; inset: 0; width: 100%; height: 100%;
      object-fit: cover;
      filter: saturate(.87) brightness(.9);
      opacity: 0; transform: scale(1.06);
      will-change: transform, opacity;
    }
    .iimg.breath {
      animation: iBreath 6s cubic-bezier(.25,.46,.45,.94) forwards;
    }
    @keyframes iBreath {
      0%   { transform: scale(1.06); }
      100% { transform: scale(1.00); }
    }
    #intro-flash {
      position: absolute; inset: 0; z-index: 13; pointer-events: none;
      background: #fff; opacity: 0;
    }
    #intro-flash.pop { animation: iFlash .55s ease-out forwards; }
    @keyframes iFlash {
      0%   { opacity:.18; }
      100% { opacity:0; }
    }
    #intro-pgnum {
      position: absolute; bottom: 18px; right: 20px;
      z-index: 12; color: rgba(255,255,255,.28);
      font-size: .65rem; letter-spacing: .1em;
      font-family: monospace; pointer-events: none;
    }
    #intro-skip {
      position: fixed;
      bottom: 12px; left: 16px; z-index: 999999;
      background: rgba(0,0,0,.10);
      border: 1px solid rgba(255,255,255,.15);
      border-radius: 22px;
      color: rgba(255,255,255,.4);
      font-size: .76rem; letter-spacing: .1em;
      padding: 6px 16px; cursor: pointer;
      backdrop-filter: blur(3px);
      display: none;
      transition: color .3s, border-color .3s, background .3s;
    }
    #intro-skip:hover {
	  color: rgba(255,255,255,.45);
	  border-color: rgba(255,255,255,.30);
	  background: rgba(0,0,0,.20);
    }

    /* ── 特效層 ── */
    #fx-vignette {
      position:absolute; inset:0; z-index:15; pointer-events:none;
      background: radial-gradient(ellipse at center, transparent 50%, rgba(0,0,0,0) 100%);
      transition: background 0.5s ease;
    }
    #fx-vignette.breathe { animation: fxVig 3s ease-in-out infinite; }
    @keyframes fxVig {
      0%,100%{ background: radial-gradient(ellipse at center, transparent 50%, rgba(0,0,0,.55) 100%); }
      50%    { background: radial-gradient(ellipse at center, transparent 35%, rgba(0,0,0,.82) 100%); }
    }
    @keyframes fxShake {
      0%  { transform:translate(0,0) rotate(0deg); }
      15% { transform:translate(-4px,3px) rotate(-.3deg); }
      30% { transform:translate(5px,-2px) rotate(.2deg); }
      45% { transform:translate(-3px,4px) rotate(-.2deg); }
      60% { transform:translate(4px,-3px) rotate(.3deg); }
      75% { transform:translate(-2px,2px) rotate(0deg); }
      100%{ transform:translate(0,0) rotate(0deg); }
    }
    #intro-cs.shake { animation: fxShake .55s cubic-bezier(.36,.07,.19,.97) forwards; }
    #fx-particles {
      position:absolute; inset:0; z-index:16; pointer-events:none; overflow:hidden;
    }
    .fx-p {
      position:absolute; border-radius:50%; opacity:0;
      animation: fxPFloat var(--pd,4s) ease-in-out var(--delay,0s) forwards;
    }
    @keyframes fxPFloat {
      0%   { opacity:0; transform:translateY(0) scale(1); }
      20%  { opacity:.9; }
      100% { opacity:0; transform:translateY(var(--py,-120px)) scale(.4); }
    }
    #fx-halo {
      position:absolute; z-index:16; pointer-events:none; border-radius:50%;
      background: radial-gradient(circle, rgba(255,220,100,.35) 0%, transparent 70%);
      opacity:0;
    }
    #fx-halo.pulse { animation: fxHalo 2.5s ease-in-out infinite; }
    @keyframes fxHalo {
      0%,100%{ opacity:.3; transform:scale(1);   }
      50%    { opacity:.7; transform:scale(1.18); }
    }
    #fx-scan {
      position:absolute; inset:0; z-index:16; pointer-events:none;
      background: repeating-linear-gradient(
        to bottom,
        transparent 0px, transparent 2px,
        rgba(80,200,255,.12) 2px, rgba(80,200,255,.12) 3px
      );
      opacity:0;
    }
    #fx-scan.sweep {
      animation: fxScanIn .5s ease forwards, fxScanPulse 1.2s ease-in-out .5s infinite;
    }
    @keyframes fxScanIn {
      0%  { opacity:0; transform:translateX(-100%); }
      100%{ opacity:1; transform:translateX(0); }
    }
    @keyframes fxScanPulse {
      0%,100%{ opacity:.6; } 50%{ opacity:1; }
    }
    #fx-glitch {
      position:absolute; inset:0; z-index:17; pointer-events:none;
      opacity:0; mix-blend-mode:screen;
    }
    #fx-glitch.go { animation: fxGlitch 1.2s steps(1) forwards; }
    @keyframes fxGlitch {
      0%  { opacity:0; }
      8%  { opacity:1; background:rgba(255,0,0,.18); transform:translate(-5px,0) scaleY(1.01); }
      18% { background:rgba(0,255,255,.18); transform:translate(6px,0); }
      28% { background:rgba(255,0,0,.14); transform:translate(-4px,2px) scaleY(.99); }
      38% { background:rgba(0,255,255,.14); transform:translate(5px,-2px); }
      50% { background:rgba(255,0,0,.10); transform:translate(-3px,0); }
      62% { background:rgba(0,255,255,.10); transform:translate(3px,0); }
      75% { background:rgba(255,0,0,.06); transform:translate(-1px,0); }
      88% { opacity:.4; }
      100%{ opacity:0; transform:translate(0,0); }
    }
    #fx-spotlight {
      position:absolute; inset:0; z-index:15; pointer-events:none; opacity:0;
      background: radial-gradient(circle 28% at 50% 50%, transparent 0%, rgba(0,0,0,.52) 100%);
      transition: opacity 1.5s ease;
    }
    #fx-spotlight.on { opacity:1; animation: fxSpot 6s ease-in-out infinite; }
    @keyframes fxSpot {
      0%,100%{ background: radial-gradient(circle 28% at 50% 42%, transparent 0%, rgba(0,0,0,.52) 100%); }
      50%    { background: radial-gradient(circle 28% at 52% 55%, transparent 0%, rgba(0,0,0,.52) 100%); }
    }
    #fx-ripple {
      position:absolute; z-index:16; pointer-events:none; border-radius:50%;
      border: 3px solid rgba(100,200,255,.85);
      box-shadow: 0 0 12px rgba(100,200,255,.5), inset 0 0 12px rgba(100,200,255,.2);
      opacity:0; transform:scale(0);
    }
    #fx-ripple.go { animation: fxRipple 2.2s ease-out forwards; }
    #fx-ripple2 {
      position:absolute; z-index:16; pointer-events:none; border-radius:50%;
      border: 2px solid rgba(100,200,255,.6);
      box-shadow: 0 0 8px rgba(100,200,255,.3);
      opacity:0; transform:scale(0);
    }
    #fx-ripple2.go { animation: fxRipple 2.2s ease-out .55s forwards; }
    #fx-ripple3 {
      position:absolute; z-index:16; pointer-events:none; border-radius:50%;
      border: 1px solid rgba(100,200,255,.4);
      opacity:0; transform:scale(0);
    }
    #fx-ripple3.go { animation: fxRipple 2.2s ease-out 1.1s forwards; }
    @keyframes fxRipple {
      0%  { opacity:1; transform:scale(0); }
      100%{ opacity:0; transform:scale(1); }
    }
    #fx-weather {
      position:absolute; inset:0; z-index:16; pointer-events:none; overflow:hidden;
    }
    .fx-w {
      position:absolute; top:-5px; border-radius:50%; opacity:0;
      animation: fxWeather var(--wd,6s) linear var(--wdelay,0s) forwards;
    }
    @keyframes fxWeather {
      0%  { opacity:0;   transform:translateY(0) translateX(0); }
      10% { opacity:.75; }
      90% { opacity:.5;  }
      100%{ opacity:0;   transform:translateY(110vh) translateX(var(--wx,20px)); }
    }
    #intro-screen.closing {
      animation: iClose 1.5s ease forwards;
      pointer-events: none;
    }
    @keyframes iClose { to { opacity: 0; } }

    /* ── 光幕掃過 ── */
    #lens-wipe {
      position: absolute; inset: 0; z-index: 60; pointer-events: none;
      overflow: hidden;
    }
    #lens-beam {
      position: absolute; left: 0; right: 0;
      top: -60%; height: 60%;
      background: linear-gradient(180deg,
        transparent 0%,
        rgba(255,255,255,0.08) 20%,
        rgba(255,255,255,0.55) 45%,
        rgba(255,255,255,1)    50%,
        rgba(255,255,255,0.55) 55%,
        rgba(255,255,255,0.08) 80%,
        transparent 100%);
      filter: blur(6px);
    }
    #lens-beam.sweep {
      animation: lensSwipe 1.8s cubic-bezier(0.4, 0, 0.2, 1) forwards;
    }
    @keyframes lensSwipe {
      0%   { top: -60%; }
      100% { top: 160%; }
    }
  `;
  document.head.appendChild(style);
})();

/* ── credits 延遲出現 ── */
setTimeout(function () {
  var c = document.getElementById('intro-credits');
  if (c) c.style.opacity = '1';
}, 2000);

/* ── 開場邏輯 ──
   注意：不能再靠 sessionStorage.getItem('skipIntro') 判斷要不要執行。
   index.html 最上面那段 inline script 在偵測到 skipIntro==='1' 時，
   會先把 #intro-screen 整個元素移除，然後立刻把旗標本身也清掉
   （sessionStorage.removeItem）。intro.js 在那之後才載入，如果還用
   同一個旗標判斷，會讀到「已經被清掉」的狀態、誤判成不用跳過，
   接著去抓一個其實已經被移除的 #intro-screen，導致
   introScr.addEventListener 打在 null 上炸掉。
   改成直接檢查 #intro-screen 元素本身還在不在，才是真正的事實來源。 */
/* ── 開場素材下載順序 ──
   頁面一開啟就下載故事圖 P1-P9 和開場音樂，兩者都下載完成（音樂以瀏覽器判斷
   可以順暢播完為準）才開始下載主遊戲背景音樂 #bgm，不讓它跟開場素材搶網路。
   iPhone 在玩家點擊畫面前完全不下載音樂，所以另外設一個保險計時器，
   開場素材遲遲沒有完成時也會照常開始下載主遊戲音樂，不會卡住。
   （魚卡、說明頁音樂、說明圖、背景影片的下載時機見 main.js DOMContentLoaded 的說明） */
var __mainBgmPreloaded = false;
function preloadMainBgm() {
  if (__mainBgmPreloaded) return;
  __mainBgmPreloaded = true;
  var mainBgm = document.getElementById('bgm');
  if (mainBgm && mainBgm.paused) {
    mainBgm.preload = 'auto';
    mainBgm.load();
  }
}

var __introScreenEl = document.getElementById('intro-screen');
if (!__introScreenEl) {
  /* 跳過開場（同分頁重新整理等情況）：沒有開場音樂要等，直接下載主遊戲音樂 */
  preloadMainBgm();
}
if (__introScreenEl) {
  (function () {
    var IMGS = ['image/P1.jpg','image/P2.jpg','image/P3.jpg','image/P4.jpg','image/P5.jpg','image/P6.jpg','image/P7.jpg','image/P8.jpg','image/P9.jpg'];
    var STAY = 11400, BREATH_DUR = 6000, FADE_OUT = 900, BLACK = 400, FADE_IN = 800;
    var alive = true, slotA = true, bgmEl = null, volTmr = null, wakeLock = null;

    /* 故事圖跟開場音樂都完成才下載主遊戲音樂：用計數器等兩件事都回報完成 */
    var introAssetsPending = 2; // 故事圖一批 + 開場音樂一首
    function introAssetDone() {
      introAssetsPending--;
      if (introAssetsPending <= 0) preloadMainBgm();
    }

    /* 開場音樂在頁面載入時就建立、開始下載（原本是點擊開場才建立，
       點下去才開始下載，音樂常常慢半拍才出來）。下載失敗也算完成，不卡住後續流程。 */
    bgmEl = new Audio('Where_the_Tide_Breaks.mp3');
    bgmEl.preload = 'auto';
    bgmEl.loop = false;
    var introMusicDone = false;
    function onIntroMusicReady() {
      if (introMusicDone) return;
      introMusicDone = true;
      introAssetDone();
    }
    bgmEl.addEventListener('canplaythrough', onIntroMusicReady, { once: true });
    bgmEl.addEventListener('error', onIntroMusicReady, { once: true });

    /* 故事圖 P1-P9：頁面一開啟就下載，9 張全部完成（個別失敗也算）才回報 */
    var storyImgsLeft = IMGS.length;
    IMGS.forEach(function (src) {
      var pre = new Image();
      pre.onload = pre.onerror = function () {
        storyImgsLeft--;
        if (storyImgsLeft === 0) introAssetDone();
      };
      pre.src = src;
      if (pre.decode) pre.decode().catch(function () {});
    });

    setTimeout(preloadMainBgm, 12000); // 保險：開場素材遲遲沒有完成也照常往下
    var imgA, imgB, blkOvl, scanEl, flashEl;

    function fadeVol(to, ms) {
      if (!bgmEl) return;
      var from = bgmEl.volume, steps = 40, dt = ms / steps, s = 0;
      clearInterval(volTmr);
      volTmr = setInterval(function () {
        s++;
        bgmEl.volume = Math.min(1, Math.max(0, from + (to - from) * (s / steps)));
        if (s >= steps) clearInterval(volTmr);
      }, dt);
    }

    /* LOGO 淡入顯示 */
    var logoEl = document.getElementById('intro-logo');
    var hintEl = document.getElementById('intro-hint');
    setTimeout(function () {
      if (logoEl) logoEl.classList.add('show');
      setTimeout(function () { if (hintEl) hintEl.classList.add('show'); }, 1100);
    }, 600);

    var introScr = __introScreenEl;
    introScr.addEventListener('click', startComic, { once: true });

    function startComic() {
      if ('wakeLock' in navigator) {
        navigator.wakeLock.request('screen').then(function (lock) {
          wakeLock = lock;
        }).catch(function () {});
      }

		/* 開場音樂已經在頁面載入時建立並開始下載，這裡直接播放同一個 */
		bgmEl.volume = 0;
		bgmEl.play().catch(function () {});
		fadeVol(0.78, 2200);

      var ts      = document.getElementById('intro-ts');
      var credits = document.getElementById('intro-credits');
      ts.style.transition      = 'opacity .55s';
      ts.style.opacity         = '0';
      credits.style.transition = 'opacity .55s';
      credits.style.opacity    = '0';
      setTimeout(function () {
        ts.style.display      = 'none';
        credits.style.display = 'none';
      }, 560);

      document.getElementById('intro-cs').style.display   = 'block';
      document.getElementById('intro-hint').style.display = 'none';
      setTimeout(function () {
        document.getElementById('intro-skip').style.display = 'block';
      }, 2000);

      imgA    = document.getElementById('iimg-a');
      imgB    = document.getElementById('iimg-b');
      blkOvl  = document.getElementById('intro-blk');
      scanEl  = document.getElementById('intro-scan');
      flashEl = document.getElementById('intro-flash');

      /* ── 光幕掃過 ── */
      var lWipe = document.createElement('div'); lWipe.id = 'lens-wipe';
      var lBeam = document.createElement('div'); lBeam.id = 'lens-beam';
      lWipe.appendChild(lBeam);
      document.getElementById('intro-screen').appendChild(lWipe);

      void lBeam.offsetWidth;
      setTimeout(function () {
        lBeam.classList.add('sweep');
        setTimeout(function () { showImg(0); }, 900);
        setTimeout(function () { lWipe.remove(); }, 1900);
      }, 120);
    }

    /* ══ 特效引擎 ══ */
    var fxTimers = [];
    function fxClear() {
      fxTimers.forEach(clearTimeout); fxTimers = [];
      document.getElementById('fx-vignette').className  = '';
      document.getElementById('fx-particles').innerHTML = '';
      document.getElementById('fx-weather').innerHTML   = '';
      var halo = document.getElementById('fx-halo');
      halo.className = ''; halo.style.cssText = '';
      document.getElementById('fx-spotlight').className = '';
      var sc = document.getElementById('fx-scan');
      sc.className = ''; void sc.offsetWidth;
      var gl = document.getElementById('fx-glitch');
      gl.className = ''; void gl.offsetWidth;
      var r1 = document.getElementById('fx-ripple');
      r1.className = ''; r1.style.cssText = '';
      var r2 = document.getElementById('fx-ripple2');
      r2.className = ''; r2.style.cssText = '';
      var r3 = document.getElementById('fx-ripple3');
      r3.className = ''; r3.style.cssText = '';
    }
    function fxAt(ms, fn) { fxTimers.push(setTimeout(fn, ms)); }

    function fxM() { document.getElementById('fx-vignette').classList.add('breathe'); }
    function fxF() {
      var cs = document.getElementById('intro-cs');
      cs.classList.remove('shake'); void cs.offsetWidth; cs.classList.add('shake');
    }
    function fxA(color) {
      var el = document.getElementById('fx-particles');
      el.innerHTML = '';
      var colors = {
        gold: ['rgba(255,220,80,.9)', 'rgba(255,180,40,.8)', 'rgba(255,255,150,.7)'],
        blue: ['rgba(100,200,255,.9)', 'rgba(150,230,255,.8)', 'rgba(80,170,255,.7)'],
        warm: ['rgba(255,160,60,.9)',  'rgba(255,200,80,.8)',  'rgba(255,120,40,.7)']
      };
      var cl = colors[color] || colors.blue;
      for (var i = 0; i < 28; i++) {
        var p  = document.createElement('div');
        p.className = 'fx-p';
        var sz = (Math.random() * 4 + 2) + 'px';
        var px = Math.random() * 100;
        var py = -(80 + Math.random() * 140);
        var pd = (2.5 + Math.random() * 2.5).toFixed(1) + 's';
        var dl = (Math.random() * 1.5).toFixed(2) + 's';
        p.style.cssText = 'width:' + sz + ';height:' + sz +
          ';left:' + px + '%;bottom:' + (5 + Math.random() * 30) + '%;' +
          'background:' + cl[Math.floor(Math.random() * cl.length)] + ';' +
          '--py:' + py + 'px;--pd:' + pd + ';--delay:' + dl + ';' +
          'box-shadow:0 0 4px ' + cl[0] + ';';
        el.appendChild(p);
      }
    }
    function fxB(cx, cy) {
      var h  = document.getElementById('fx-halo');
      var sw = document.getElementById('intro-screen').offsetWidth;
      var sh = document.getElementById('intro-screen').offsetHeight;
      var sz = Math.min(sw, sh) * 0.7;
      h.style.cssText = 'width:' + sz + 'px;height:' + sz + 'px;' +
        'left:' + (sw * cx / 100 - sz / 2) + 'px;top:' + (sh * cy / 100 - sz / 2) + 'px;';
      h.classList.add('pulse');
    }
    function fxE() {
      var s = document.getElementById('fx-scan');
      s.classList.remove('sweep'); void s.offsetWidth; s.classList.add('sweep');
    }
    function fxG() {
      var g = document.getElementById('fx-glitch');
      g.classList.remove('go'); void g.offsetWidth; g.classList.add('go');
    }
    function fxH() { document.getElementById('fx-spotlight').classList.add('on'); }
    function fxI(cx, cy) {
      var scr  = document.getElementById('intro-screen');
      var sw   = scr.offsetWidth, sh = scr.offsetHeight;
      var sz   = Math.min(sw, sh) * 0.85;
      var base = 'width:' + sz + 'px;height:' + sz + 'px;' +
                 'left:' + (sw * cx / 100 - sz / 2) + 'px;' +
                 'top:'  + (sh * cy / 100 - sz / 2) + 'px;';
      ['fx-ripple','fx-ripple2','fx-ripple3'].forEach(function (id) {
        var r = document.getElementById(id);
        r.style.cssText = base; r.classList.remove('go'); void r.offsetWidth; r.classList.add('go');
      });
    }
    function fxK() {
      var el = document.getElementById('fx-weather');
      el.innerHTML = '';
      for (var i = 0; i < 22; i++) {
        var p   = document.createElement('div');
        p.className = 'fx-w';
        var sz  = (Math.random() * 3 + 1.5) + 'px';
        var col = Math.random() > .5 ? 'rgba(255,160,60,.8)' : 'rgba(255,210,80,.7)';
        p.style.cssText =
          'width:' + sz + ';height:' + sz + ';' +
          'left:' + (Math.random() * 100) + '%;' +
          'background:' + col + ';' +
          '--wd:' + (5 + Math.random() * 4).toFixed(1) + 's;' +
          '--wdelay:' + (Math.random() * 2).toFixed(2) + 's;' +
          '--wx:' + ((Math.random() - 0.5) * 60).toFixed(0) + 'px;' +
          'box-shadow:0 0 3px rgba(255,150,30,.6);';
        el.appendChild(p);
      }
    }

    /* ══ 每頁特效排程表 ══ */
    var PAGE_FX = [
      function () { fxAt(5000, fxM); fxAt(6000, fxF); },
      function () { fxAt(6000, function () { fxA('gold'); fxB(50, 30); }); },
      function () { fxAt(6000, fxE); fxAt(7000, fxG); },
      function () { fxAt(6000, function () { fxI(50, 65); }); fxAt(7000, function () { fxA('blue'); }); },
      function () { fxAt(6000, fxF); fxAt(8000, function () { fxB(50, 45); }); },
      function () { fxAt(6000, fxH); fxAt(9000, fxM); },
      function () { fxAt(6000, fxG); fxAt(7000, fxF); },
      function () { fxAt(6000, function () { fxA('blue'); }); fxAt(7000, function () { fxI(50, 50); }); },
      function () { fxAt(6000, fxK); fxAt(7000, function () { fxA('warm'); }); }
    ];

    function showImg(n) {
      if (!alive) return;
      fxClear();
      document.getElementById('intro-pgnum').textContent = '● ' + (n + 1) + ' / ' + IMGS.length;
      var inc = slotA ? imgA : imgB;
      var out = slotA ? imgB : imgA;

      blkOvl.style.opacity = '1';
      scanEl.classList.remove('sweep'); void scanEl.offsetWidth;

      inc.src = IMGS[n];
      inc.classList.remove('breath');
      inc.removeAttribute('style');
      inc.style.opacity    = '0';
      inc.style.transform  = 'scale(1.06)';
      inc.style.transition = 'opacity 0s';

      setTimeout(function () {
        blkOvl.style.opacity = '0';
        inc.style.transition = 'opacity ' + FADE_IN + 'ms cubic-bezier(.4,0,.2,1)';
        inc.style.opacity    = '1';
        inc.style.setProperty('--breath-dur', BREATH_DUR + 'ms');
        void inc.offsetWidth;
        inc.classList.add('breath');

        out.style.transition = 'opacity ' + FADE_OUT + 'ms ease';
        out.style.opacity    = '0';
        slotA = !slotA;

        if (PAGE_FX[n]) PAGE_FX[n]();
        setTimeout(function () { scanEl.classList.add('sweep'); }, 300);

        flashEl.classList.remove('pop'); void flashEl.offsetWidth; flashEl.classList.add('pop');

        if (n < IMGS.length - 1) {
          setTimeout(function () { if (alive) showImg(n + 1); }, STAY);
        } else {
          setTimeout(function () {
            if (!alive) return;
            fadeVol(0.5, 2000);
            endIntro(false);
          }, STAY);
        }
      }, FADE_OUT + BLACK);
    }

    function endIntro(fast) {
      alive = false;
      fxTimers.forEach(clearTimeout); fxTimers = [];
      fadeVol(0, fast ? 600 : 1500);
      if (wakeLock) { wakeLock.release(); wakeLock = null; }
      var scr = document.getElementById('intro-screen');
      scr.classList.add('closing');
      setTimeout(function () {
        if (bgmEl) { bgmEl.pause(); bgmEl = null; }
        scr.remove();
        var w = document.getElementById('welcome-screen');
        if (w) {
          w.style.display    = 'flex';
          w.style.opacity    = '0';
          w.style.transition = 'opacity .85s ease';
          setTimeout(function () { w.style.opacity = '1'; }, 30);
        }
      }, fast ? 700 : 1500);
    }

    window.introSkip = function () {
      if (!alive) return;
      alive = false;
      fxTimers.forEach(clearTimeout); fxTimers = [];
      introScr.removeEventListener('click', startComic);
      endIntro(true);
    };
  })();
}
