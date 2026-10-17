// =====================================================
// 會員系統：自訂名稱＋密碼（不收集 Email／個人資料）
// 對應功能規格書 6.1 節
// =====================================================
import { auth, db, INTERNAL_EMAIL_DOMAIN } from './firebase-config.js';
import {
    createUserWithEmailAndPassword,
    signInWithEmailAndPassword,
    signOut,
    onAuthStateChanged,
    updatePassword,
    reauthenticateWithCredential,
    EmailAuthProvider
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
    doc, getDoc, runTransaction
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const DEFAULT_PROFILE = { level: 1, coins: 0, badges: [], certificates: [], itemTickets: [] };

const USERNAME_RULE = /^[A-Za-z0-9\u4e00-\u9fa5]{1,20}$/; // 中英文數字，最長20字

function usernameToEmail(username) {
    return `${username.toLowerCase()}@${INTERNAL_EMAIL_DOMAIN}`;
}

export function validateUsername(username) {
    if (!username) return '請輸入使用者名稱';
    if (!USERNAME_RULE.test(username)) return '名稱僅接受中文、英文、數字，最長 20 個字元';
    return null;
}

export function validatePassword(password) {
    if (!password) return '請輸入密碼';
    if (password.length < 6) return '密碼至少需要 6 個字元';
    if (password.length > 64) return '密碼最長 64 個字元';
    if (!password.trim()) return '密碼不能全部是空白';
    return null;
}

// 檢查名稱是否已被使用（即時檢查用，最終仍以註冊時的 Firestore 規則為準）
export async function isUsernameTaken(username) {
    const snap = await getDoc(doc(db, 'usernames', username.toLowerCase()));
    return snap.exists();
}

// 隨機挑一個動物頭像 id（實際清單由 content.js 的 avatarPresets 決定，這裡先給預設值）
function pickDefaultAvatar(avatarPresetIds) {
    if (!avatarPresetIds || avatarPresetIds.length === 0) return null;
    return avatarPresetIds[Math.floor(Math.random() * avatarPresetIds.length)];
}

// Auth 與 Firestore 不屬於同一交易。等待整個流程後再通知畫面登入。
let authOperation = null;
async function withAuthOperation(work) {
    if (authOperation) throw new Error('帳號處理中，請稍候');
    let release;
    authOperation = new Promise(resolve => { release = resolve; });
    try { return await work(); }
    finally { authOperation = null; release(); }
}
function authError(err) {
    const messages = {
        'auth/email-already-in-use': '此帳號已建立，請使用原帳號與密碼登入；若之前註冊中斷，登入會嘗試完成登記。',
        'auth/network-request-failed': '網路連線失敗，請確認連線後再試。若剛才正在註冊，請先使用原帳密登入確認。',
        'auth/too-many-requests': '嘗試次數過多，請稍後再試。',
        'auth/weak-password': '密碼不符合要求，請重新設定。',
        'auth/invalid-email': '此名稱無法建立帳號，請更換名稱。',
        'auth/operation-not-allowed': '目前無法建立帳號，請聯絡管理者。',
        'auth/invalid-credential': '帳號或密碼錯誤',
        'auth/user-not-found': '帳號或密碼錯誤',
        'auth/wrong-password': '帳號或密碼錯誤',
        'auth/user-disabled': '此帳號目前停用，請聯絡管理者。'
    };
    return new Error(messages[err.code] || '帳號處理失敗，請稍後再試。');
}
async function completeRegistration(user, username, avatarIds, selectedAvatarId) {
    const usernameLower = username.toLowerCase();
    // 只補建本人缺少的資料，絕不覆蓋既有玩家或其他人的名稱。
    return runTransaction(db, async tx => {
        const nameRef = doc(db, 'usernames', usernameLower);
        const profileRef = doc(db, 'users', user.uid);
        const name = await tx.get(nameRef);
        const profile = await tx.get(profileRef);
        if (name.exists() && name.data().uid !== user.uid)
            throw new Error('此名稱已有其他玩家使用，請聯絡管理者確認帳號。');
        if (profile.exists()) return;
        if (!name.exists()) tx.set(nameRef, { uid: user.uid });
        tx.set(profileRef, {
            nickname: username,
            avatarId: avatarIds.includes(selectedAvatarId) ? selectedAvatarId : pickDefaultAvatar(avatarIds),
            ...DEFAULT_PROFILE
        });
    });
}
export async function registerUser(username, password, avatarPresetIds = [], selectedAvatarId = null) {
    username = username.trim();
    const usernameErr = validateUsername(username);
    const passwordErr = validatePassword(password);
    if (usernameErr || passwordErr) throw new Error(usernameErr || passwordErr);
    return withAuthOperation(async () => {
        let taken;
        try { taken = await isUsernameTaken(username); }
        catch { throw new Error('無法確認名稱是否可用，請檢查連線後再試。'); }
        if (taken) throw new Error('此名稱已被使用；已有帳號請切換至登入。');
        let cred;
        try { cred = await createUserWithEmailAndPassword(auth, usernameToEmail(username), password); }
        catch (err) { throw authError(err); }
        try { await completeRegistration(cred.user, username, avatarPresetIds, selectedAvatarId); }
        catch {
            // 不刪除帳號，避免交易結果不明時誤刪已成功建立的玩家。
            throw new Error('帳號已建立，但尚未確認登記完成。請保留原帳號與密碼，切換至登入重試；仍失敗請聯絡管理者。');
        }
        return cred.user.uid;
    });
}
export async function loginUser(username, password) {
    username = username.trim();
    const invalid = validateUsername(username);
    if (invalid) throw new Error(invalid);
    if (!password) throw new Error('請輸入密碼');
    return withAuthOperation(async () => {
        let cred;
        try { cred = await signInWithEmailAndPassword(auth, usernameToEmail(username), password); }
        catch (err) { throw authError(err); }
        try { await completeRegistration(cred.user, username, [], null); }
        catch { throw new Error('登入驗證成功，但個人資料尚未讀取或完成，請確認連線後重試；仍失敗請聯絡管理者。'); }
        return cred.user;
    });
}

export async function logoutUser() {
    await signOut(auth);
}

// 修改密碼：需先用目前密碼重新驗證身分，才能改成新密碼（Firebase 安全機制要求）
export async function changePassword(username, currentPassword, newPassword) {
    const user = auth.currentUser;
    if (!user) throw new Error('請先登入');
    const email = usernameToEmail(username);
    const credential = EmailAuthProvider.credential(email, currentPassword);
    try {
        await reauthenticateWithCredential(user, credential);
    } catch (err) {
        throw new Error('原密碼不正確');
    }
    const passwordErr = validatePassword(newPassword);
    if (passwordErr) throw new Error(passwordErr);
    await updatePassword(user, newPassword);
}

// 查無個人資料時，不要直接判定成「沒登入」——註冊流程裡 createUserWithEmailAndPassword
// 一成功就會觸發這裡，但當下 registerUser() 自己可能還沒寫完 users/{uid} 這份文件（race
// condition），先重試幾次、留一點緩衝時間，避免誤判成未登入（新註冊的玩家看到自己變成
// 「未登記隊員」）。
async function ensureUserProfile(fbUser, retriesLeft = 4) {
    const ref = doc(db, 'users', fbUser.uid);
    const snap = await getDoc(ref);
    if (snap.exists()) return snap.data();
    if (retriesLeft > 0) {
        await new Promise(resolve => setTimeout(resolve, 350));
        return ensureUserProfile(fbUser, retriesLeft - 1);
    }
    return null;
}

export function watchAuthState(callback) {
    return onAuthStateChanged(auth, async fbUser => {
        const pending = authOperation;
        if (pending) await pending;
        // 忽略等待期間已登出或換帳號的過時回呼。
        if ((auth.currentUser?.uid || null) !== (fbUser?.uid || null)) return;
        if (!fbUser) return callback(null);
        try {
            const profile = await ensureUserProfile(fbUser);
            if (auth.currentUser?.uid !== fbUser.uid) return;
            callback(profile ? { uid: fbUser.uid, ...profile } : null);
        } catch { callback(null); }
    });
}
