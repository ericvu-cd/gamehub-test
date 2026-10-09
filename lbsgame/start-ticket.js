// Shared pre-game ticket confirmation. Unknown transaction outcomes keep the same request ID.
(() => {
  let inventory = [], pending = null;
  const platformWindow = window.parent !== window ? window.parent : window.opener;
  const origins = new Set([location.origin]);
  if (document.referrer) { try { origins.add(new URL(document.referrer).origin); } catch {} }
  window.addEventListener('message', event => {
    const msg = event.data;
    if (!platformWindow || event.source !== platformWindow || !origins.has(event.origin) || msg?.source !== 'culture-platform') return;
    if (msg.type === 'player_info') inventory = msg.payload?.itemTickets || [];
    if (msg.type !== 'item_ticket_result' || !pending || msg.taskId !== pending.taskId || msg.itemId !== pending.itemId || msg.requestId !== pending.requestId) return;
    if (Array.isArray(msg.itemTickets)) inventory = msg.itemTickets;
    clearTimeout(pending.timer);
    if (msg.ok) { const p = pending; pending = null; p.overlay.remove(); p.resolve(true); return; }
    pending.status.textContent = msg.reason || '使用失敗，請重試。';
    pending.use.disabled = false;
    pending.use.textContent = msg.uncertain ? '重試確認' : '重試使用';
    pending.skip.disabled = !!msg.uncertain;
    if (!msg.uncertain) pending.requestId = null;
  });
  window.chooseStartTicket = (taskId, itemId, name, description) => {
    if (pending) return pending.promise;
    if (!inventory.includes(itemId)) return Promise.resolve(false);
    const overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;inset:0;z-index:99999;background:#000b;display:grid;place-items:center;padding:20px';
    overlay.innerHTML = '<div style="background:#fff9eb;color:#243c40;border:3px solid #238c88;border-radius:18px;padding:24px;max-width:360px;font:16px sans-serif;text-align:center"><h2></h2><p></p><p role="status"></p><button data-use style="padding:12px;margin:6px">使用道具券</button><button data-skip style="padding:12px;margin:6px">不用，直接開始</button></div>';
    overlay.querySelector('h2').textContent = '使用' + name + '？';
    overlay.querySelector('p').textContent = description;
    const status = overlay.querySelector('[role=status]'), use = overlay.querySelector('[data-use]'), skip = overlay.querySelector('[data-skip]');
    let resolve; const promise = new Promise(r => resolve = r);
    pending = {taskId, itemId, overlay, status, use, skip, resolve, promise, requestId:null, timer:null};
    skip.onclick = () => { if (skip.disabled) return; pending = null; overlay.remove(); resolve(false); };
    use.onclick = () => {
      const p = pending; if (!p || use.disabled) return;
      p.requestId ||= crypto.randomUUID(); use.disabled = true; skip.disabled = true; status.textContent = '正在確認道具券，請稍候…';
      sendToPlatform('use_item_ticket', {itemId, requestId:p.requestId});
      p.timer = setTimeout(() => { if (pending !== p) return; status.textContent = '尚未確認結果，請重試確認。'; use.disabled = false; use.textContent = '重試確認'; }, 12000);
    };
    document.body.appendChild(overlay); return promise;
  };
})();
