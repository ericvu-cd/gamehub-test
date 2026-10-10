// Platform dialogs use native dialog layout, with explicit centering to override CSS resets.
export function showPlatformDialog({ title = '提示', message = '', confirmText = '確定', cancelText = null } = {}) {
    const dialog = document.createElement('dialog');
    dialog.style.cssText = 'position:fixed;inset:0;margin:auto;width:min(340px,calc(100vw - 48px));max-height:calc(100dvh - 48px);overflow:auto;box-sizing:border-box;border:1px solid #7185aa;border-radius:18px;padding:24px;background:#101a35;color:#fff;font-family:inherit;';
    dialog.setAttribute('aria-label', title);
    dialog.innerHTML = '<style>dialog::backdrop{background:rgba(0,0,0,.65)}</style><h2 style="font-size:20px;margin:0 0 14px"></h2><p style="white-space:pre-line;line-height:1.7;overflow-wrap:anywhere"></p><div style="display:flex;gap:12px;margin-top:24px"><button data-cancel type="button" style="flex:1;padding:12px;border-radius:10px">取消</button><button data-ok type="button" style="flex:1;padding:12px;border-radius:10px;background:#71e2c4;color:#10253a;font-weight:bold">確定</button></div>';
    dialog.querySelector('h2').textContent = title;
    dialog.querySelector('p').textContent = message;
    const cancel = dialog.querySelector('[data-cancel]'), ok = dialog.querySelector('[data-ok]');
    cancel.hidden = !cancelText;
    cancel.textContent = cancelText || '';
    ok.textContent = confirmText;
    const previousFocus = document.activeElement;
    document.body.appendChild(dialog);
    return new Promise(resolve => {
        let settled = false;
        const finish = result => {
            if (settled) return;
            settled = true; dialog.close(); dialog.remove();
            if (previousFocus?.isConnected) previousFocus.focus();
            resolve(result);
        };
        cancel.onclick = () => finish(false);
        ok.onclick = () => finish(true);
        dialog.addEventListener('cancel', e => { e.preventDefault(); finish(false); });
        dialog.showModal();
        (cancelText ? cancel : ok).focus();
    });
}
export const platformConfirm = (message, title = '確認', confirmText = '確定') =>
    showPlatformDialog({ title, message, confirmText, cancelText: '取消' });
export const platformAlert = (message, title = '提示') =>
    showPlatformDialog({ title, message });
