// 船員證只使用平台已載入的玩家資料，不另外讀寫資料庫。
const HARBORS = [
    { id: 'mlhbtrip_longfeng', name: '龍鳳漁港' },
    { id: 'mlhbtrip_waipu', name: '外埔漁港' },
    { id: 'mlhbtrip_yuangang', name: '苑港漁港' }
];

export function getCrewTitle(level, visited) {
    if (visited === 3) return '苗栗海線探索員';
    if (level >= 5) return '友魚守護者';
    if (level >= 3) return '資深船員';
    if (level >= 2 || visited > 0) return '海線探索員';
    return '新進船員';
}

let activeClose = null;
export function closeCrewCard() { activeClose?.(); }

function fitText(ctx, text, maxWidth, size, minimum = 18) {
    while (size > minimum) {
        ctx.font = `700 ${size}px "Noto Sans TC", sans-serif`;
        if (ctx.measureText(text).width <= maxWidth) break;
        size--;
    }
    ctx.font = `700 ${size}px "Noto Sans TC", sans-serif`;
}

function makeCard(data) {
    const canvas = document.createElement('canvas');
    canvas.width = 900;
    canvas.height = 1120;
    const c = canvas.getContext('2d');
    const bg = c.createLinearGradient(0, 0, 900, 1120);
    bg.addColorStop(0, '#163b57');
    bg.addColorStop(1, '#081c33');
    c.fillStyle = bg;
    c.fillRect(0, 0, 900, 1120);
    c.strokeStyle = '#cfb87c';
    c.lineWidth = 3;
    c.strokeRect(30, 30, 840, 1060);
    c.strokeStyle = 'rgba(207,184,124,.3)';
    c.strokeRect(42, 42, 816, 1036);
    c.textAlign = 'center';
    c.fillStyle = '#cfb87c';
    c.font = '700 19px sans-serif';
    c.fillText('CREW PASS · EXPLORE THE COAST', 450, 100);
    c.fillStyle = '#fff4d8';
    c.font = '900 58px "Noto Sans TC", sans-serif';
    c.fillText('船員證', 450, 177);
    // 羅盤線條以 Canvas 繪製，分享圖片無需下載外部素材。
    c.beginPath();
    c.arc(450, 307, 82, 0, Math.PI * 2);
    c.fillStyle = '#214d65';
    c.fill();
    c.strokeStyle = '#cfb87c';
    c.stroke();
    c.font = '72px sans-serif';
    c.textBaseline = 'middle';
    c.fillText(data.avatar, 450, 308);
    c.textBaseline = 'alphabetic';
    c.fillStyle = '#fff';
    fitText(c, data.name, 748, 48);
    c.fillText(data.name, 450, 428);
    c.fillStyle = '#f0d595';
    c.font = '700 29px "Noto Sans TC", sans-serif';
    c.fillText(`Lv.${data.level}  ·  ${data.title}`, 450, 485);
    c.strokeStyle = 'rgba(207,184,124,.4)';
    c.beginPath(); c.moveTo(90, 529); c.lineTo(810, 529); c.stroke();
    c.fillStyle = '#b7d4df';
    c.font = '500 24px "Noto Sans TC", sans-serif';
    c.fillText('三港到訪進度', 450, 591);
    c.fillStyle = '#fff4d8';
    c.font = '900 45px sans-serif';
    c.fillText(`${data.visited} / 3`, 450, 650);
    data.harbors.forEach((h, i) => {
        const x = 210 + i * 240;
        c.beginPath(); c.arc(x, 720, 25, 0, Math.PI * 2);
        c.fillStyle = h.owned ? '#cfb87c' : '#294759'; c.fill();
        c.fillStyle = h.owned ? '#102d42' : '#a5bac7';
        c.font = '700 24px sans-serif';
        c.fillText(h.owned ? '✓' : '—', x, 729);
        c.fillStyle = '#fff';
        c.font = '700 24px "Noto Sans TC", sans-serif';
        c.fillText(h.name, x, 785);
        c.fillStyle = '#b7d4df';
        c.font = '500 19px "Noto Sans TC", sans-serif';
        c.fillText(h.owned ? '已到訪' : '待探索', x, 820);
    });
    c.fillStyle = '#173c50';
    c.fillRect(110, 859, 680, 105);
    c.fillStyle = '#b7d4df';
    c.font = '500 24px "Noto Sans TC", sans-serif';
    c.fillText('已收藏徽章', 330, 920);
    c.fillStyle = '#f0d595';
    c.font = '900 44px sans-serif';
    c.fillText(`${data.badgeCount} 枚`, 590, 926);
    c.fillStyle = '#b7d4df';
    c.font = '500 22px "Noto Sans TC", sans-serif';
    c.fillText('在地文化知識型互動平台', 450, 1021);
    c.font = '500 17px "Noto Sans TC", sans-serif';
    c.fillText('帶著好奇心出航，留下你的海線故事', 450, 1056);
    return canvas;
}

function injectStyles() {
    if (document.getElementById('crew-card-style')) return;
    const style = document.createElement('style');
    style.id = 'crew-card-style';
    style.textContent = `
      .crew-overlay{position:fixed;inset:0;z-index:180;background:rgba(4,12,25,.88);display:flex;align-items:center;justify-content:center;padding:16px;box-sizing:border-box}
      .crew-dialog{width:100%;max-width:380px;max-height:calc(100dvh - 32px);overflow:auto;background:#102d42;border:1px solid #cfb87c;border-radius:20px;padding:14px;color:#fff;box-sizing:border-box}
      .crew-header{display:flex;align-items:center;justify-content:space-between;margin-bottom:10px}
      .crew-header h2{margin:0;font-size:18px}
      .crew-close{border:0;background:transparent;color:#fff;font:inherit;font-size:25px;cursor:pointer;width:40px;height:40px}
      .crew-picture{display:block;width:100%;height:auto;border-radius:10px}
      .crew-actions{display:flex;gap:10px;margin-top:12px}
      .crew-actions button{flex:1;border:0;border-radius:12px;padding:13px 8px;font-family:inherit;font-size:14px;font-weight:700;cursor:pointer;min-height:44px}
      .crew-share{background:#edd292;color:#102d42}.crew-download{background:#28536b;color:#fff}
      .crew-actions button:disabled{opacity:.45;cursor:wait}
      .crew-status{font-size:12px;line-height:1.6;color:#bfd5df;margin:10px 0 0}
      .crew-rules{font-size:11px;color:#bfd5df;margin-top:10px}
    `;
    document.head.appendChild(style);
}

export function openCrewCard({ user, avatar, level }) {
    closeCrewCard();
    injectStyles();
    const certs = new Set(user.certificates || []);
    const harbors = HARBORS.map(h => ({ ...h, owned: certs.has(h.id) }));
    const visited = harbors.filter(h => h.owned).length;
    const data = {
        name: user.nickname || '船員', avatar: avatar || '🙂', level,
        title: getCrewTitle(level, visited), harbors, visited,
        badgeCount: new Set(user.badges || []).size
    };
    const overlay = document.createElement('div');
    overlay.className = 'crew-overlay';
    overlay.innerHTML = `
      <section class="crew-dialog" role="dialog" aria-modal="true" aria-labelledby="crew-card-title" tabindex="-1">
        <div class="crew-header"><h2 id="crew-card-title">我的船員證</h2><button class="crew-close" aria-label="關閉船員證">×</button></div>
        <img class="crew-picture" alt="">
        <div class="crew-actions"><button class="crew-share" disabled>分享船員證</button><button class="crew-download" disabled>下載圖片</button></div>
        <p class="crew-status" role="status" aria-live="polite">正在製作船員證…</p>
        <details class="crew-rules"><summary>稱號取得方式</summary>集滿三港通行證：苗栗海線探索員（優先顯示）<br>Lv.5 起：友魚守護者；Lv.3 起：資深船員<br>Lv.2 起或到訪任一港：海線探索員；其餘：新進船員</details>
      </section>`;
    const previousFocus = document.activeElement;
    const oldOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const picture = overlay.querySelector('.crew-picture');
    const shareButton = overlay.querySelector('.crew-share');
    const downloadButton = overlay.querySelector('.crew-download');
    const status = overlay.querySelector('.crew-status');
    let file = null, objectUrl = null, closed = false;
    const close = () => {
        if (closed) return;
        closed = true;
        overlay.remove();
        document.body.style.overflow = oldOverflow;
        document.removeEventListener('keydown', onKey);
        if (objectUrl) URL.revokeObjectURL(objectUrl);
        if (activeClose === close) activeClose = null;
        if (previousFocus?.isConnected) previousFocus.focus();
    };
    const onKey = e => {
        if (e.key === 'Escape') { e.preventDefault(); close(); }
        if (e.key !== 'Tab') return;
        const items = [...overlay.querySelectorAll('button:not(:disabled), summary')];
        const first = items[0], last = items[items.length - 1];
        if (e.shiftKey && (document.activeElement === first || document.activeElement === overlay.querySelector('.crew-dialog'))) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    };
    activeClose = close;
    document.addEventListener('keydown', onKey);
    overlay.querySelector('.crew-close').onclick = close;
    overlay.onclick = e => { if (e.target === overlay) close(); };
    document.body.appendChild(overlay);
    overlay.querySelector('.crew-close').focus();
    picture.alt = `${data.name}的船員證，Lv.${data.level}，${data.title}，三港已到訪${visited}處，已收藏${data.badgeCount}枚徽章。`;

    downloadButton.onclick = () => {
        if (!objectUrl) return;
        const a = document.createElement('a');
        a.href = objectUrl; a.download = '船員證.png';
        document.body.appendChild(a); a.click(); a.remove();
        status.textContent = '已送出圖片下載；若瀏覽器未下載，可長按船員證圖片儲存後分享。';
    };
    shareButton.onclick = async () => {
        if (!file) return;
        try {
            // 在點擊當下呼叫分享，圖片已事先產生，保留手機要求的使用者操作資格。
            if (!navigator.share || !navigator.canShare?.({ files: [file] })) {
                status.textContent = '此瀏覽器不支援圖片分享，請下載圖片後分享，或長按圖片儲存。';
                return;
            }
            await navigator.share({ files: [file], title: '我的船員證', text: '帶著好奇心出航，探索苗栗海線！' });
            if (!closed) status.textContent = '船員證已交給分享工具。';
        } catch (err) {
            if (closed) return;
            status.textContent = err.name === 'AbortError'
                ? '已取消分享，可隨時再試。'
                : '目前無法開啟分享，請下載圖片後分享，或長按圖片儲存。';
        }
    };
    (async () => {
        try {
            if (document.fonts) {
                await Promise.race([
                    document.fonts.load('700 48px "Noto Sans TC"'),
                    new Promise(resolve => setTimeout(resolve, 1500))
                ]);
            }
            if (closed) return;
            const canvas = makeCard(data);
            const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
            if (!blob) throw new Error('圖片製作失敗');
            if (closed) return;
            objectUrl = URL.createObjectURL(blob);
            picture.src = objectUrl;
            file = new File([blob], '船員證.png', { type: 'image/png' });
            shareButton.disabled = downloadButton.disabled = false;
            status.textContent = '分享圖片包含船員名稱與探索成果。可分享給朋友，或下載留念。';
        } catch {
            if (!closed) status.textContent = '船員證圖片製作失敗，請關閉後重新開啟。';
        }
    })();
}
