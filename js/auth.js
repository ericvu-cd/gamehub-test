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

const DEFAULT_PROFILE = { level: 1, coins: 0, badges: [], certificates: [] };

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

export async function registerUser(username, password, avatarPresetIds = []) {
    const usernameErr = validateUsername(username);
    if (usernameErr) throw new Error(usernameErr);

    const usernameLower = username.toLowerCase();
    if (await isUsernameTaken(usernameLower)) {
        throw new Error('此名稱已被使用，請換一個');
    }

    const email = usernameToEmail(username);
    const cred = await createUserWithEmailAndPassword(auth, email, password);
    const uid = cred.user.uid;

    // 用 runTransaction 把「保留使用者名稱」跟「寫入個人資料」綁成同一個不可分割的
    // 操作：以前用兩次獨立的 setDoc，如果第一個成功、第二個因為網路問題等原因失敗，
    // 會留下一個「名稱已保留、但個人資料不存在」的孤兒帳號——這個帳號密碼登得進
    // Firebase Auth，但 ensureUserProfile() 永遠查不到資料，玩家永遠卡在「未登記隊員」，
    // 這個名稱也永久卡死、沒辦法重新註冊，沒有自助復原的路。改成 transaction 之後，
    // 兩份文件要嘛一起寫成功、要嘛一起失敗，不會再有寫一半的中間狀態。
    try {
        await runTransaction(db, async (tx) => {
            const usernameRef = doc(db, 'usernames', usernameLower);
            const usersRef = doc(db, 'users', uid);
            tx.set(usernameRef, { uid });
            tx.set(usersRef, {
                nickname: username,
                avatarId: pickDefaultAvatar(avatarPresetIds),
                ...DEFAULT_PROFILE
            });
        });
    } catch (err) {
        // 名稱保留失敗（例如 race condition 下被搶先註冊），交易整個回滾，
        // 不會留下孤兒帳號；但 Auth 帳號本身無法在用戶端自行刪除，
        // 提示使用者這組帳密已建立但名稱重複，請聯繫管理者或改用別的名稱重新嘗試。
        throw new Error('註冊過程發生問題（可能名稱剛好被搶註），請換一個名稱再試一次');
    }

    return uid;
}

export async function loginUser(username, password) {
    const email = usernameToEmail(username);
    try {
        const cred = await signInWithEmailAndPassword(auth, email, password);
        return cred.user;
    } catch (err) {
        throw new Error('帳號或密碼錯誤');
    }
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
    return onAuthStateChanged(auth, async (fbUser) => {
        if (!fbUser) return callback(null);
        const profile = await ensureUserProfile(fbUser);
        if (!profile) return callback(null); // 理論上不會發生，防呆
        callback({ uid: fbUser.uid, ...profile });
    });
}
