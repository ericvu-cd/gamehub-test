# 在地文化知識型互動平台

依照功能規格書 v2.5、任務頁面通訊介面規格 v2.0、firestore.rules 產生的完整程式碼。

## 檔案結構

```
index.html              # 平台首頁
css/style.css             # 視覺樣式（漸層背景/卡片/陰影，見規格書第5章）
js/
  firebase-config.js       # 你的 Firebase 專案設定（需手動填入）
  auth.js                     # 會員系統：自訂名稱＋密碼註冊登入、改密碼
  content.js                    # 讀取 Firestore 內容資料
  coins.js                        # 通行金幣異動邏輯（每日登入/任務扣款/任務獎勵）
  tasks.js                          # 開新視窗＋postMessage 任務通訊
  leaderboard.js                      # 排行榜（個人最佳成績制）
  main.js                               # 主程式，串起所有畫面與邏輯
admin/
  index.html               # 管理後台頁面
  admin.js                    # 管理後台邏輯（Google 登入 + CRUD）
tasks/
  sample-task.html          # 示範任務頁面，可參考如何整合 postMessage 協定
scripts/
  seed.js                     # 一次性資料初始化腳本（本機執行，非部署用）
firestore.rules              # Firestore 安全規則
package.json                   # 僅供 scripts/seed.js 使用（前端不需要 build）
```

## 第一次建置步驟

### 1. 建立 Firebase 專案
到 [Firebase 主控台](https://console.firebase.google.com/) 建立新專案（Spark 免費方案即可）。

### 2. 啟用 Authentication
Authentication → 登入方式，啟用：
- **電子郵件/密碼**（一般玩家用，內部用虛擬 Email 實作自訂帳密，見 `js/firebase-config.js` 註解）
- **Google**（管理者登入用）

### 3. 建立 Firestore 資料庫
Firestore Database → 建立資料庫（正式模式）。

### 4. 部署安全規則
把 `firestore.rules` 的內容貼到 Firestore Database → 規則 分頁，發布。

> ⚠️ 部署前強烈建議用 `firebase emulators:start` 搭配測試資料先驗證過規則，
> Firestore 規則語言沒有一般程式語言常見的除錯工具，寫錯很容易正式環境才發現。

### 5. 填入前端設定
專案設定 → 新增網頁應用程式，把取得的設定值貼到 `js/firebase-config.js` 的 `firebaseConfig`。

### 6. 寫入初始資料

這一步需要一份「服務帳戶金鑰」，讓本機的 Node.js 腳本有權限直接寫入 Firestore。
取得方式：

1. 打開 [Firebase 主控台](https://console.firebase.google.com/)，選你的專案
2. 左上角齒輪圖示 →「專案設定」
3. 上方分頁選「服務帳戶」（Service accounts）
4. 點「產生新的私密金鑰」（Generate new private key）→ 跳出確認視窗再點一次確認
5. 瀏覽器會自動下載一個 `.json` 檔（檔名類似 `你的專案名稱-firebase-adminsdk-xxxxx.json`）
6. 把這個檔案**移到專案根目錄**（跟 `package.json` 同一層，**不是**放進 `scripts/` 資料夾），並改名為 `serviceAccountKey.json`（全小寫，注意不要有多餘空白或副檔名打錯）

> ⚠️ 這個檔案等於是資料庫的最高權限金鑰，`.gitignore` 已經把它排除在外，
> 千万不要手動加回去、也不要傳到 GitHub 或分享給不相關的人。

確認金鑰檔就位後，執行：

```bash
npm install
node scripts/seed.js
```

看到 `✅ 初始資料寫入完成！` 就代表成功了。若跳出 `❌ 找不到 serviceAccountKey.json`，代表金鑰檔案的**位置或檔名**不對，回頭檢查第 6 步。

### 7. 設定管理者白名單
1. 先打開 `admin/index.html`，用你的 Google 帳號登入一次（會看到「不在白名單」畫面）
		因為你已經安裝了 Node.js，可以直接透過命令列開啟伺服器：
		在終端機執行全域安裝指令：
		npm install -g http-server
		切換到專案根目錄，執行：
		http-server -p 8080
		開啟瀏覽器輸入 http://localhost:8080/admin/index.html 即可。
2. 到 Firebase 主控台 Authentication 分頁，找到剛剛登入的帳號，複製它的 uid
3. 到 Firestore Database，手動建立一份文件：collection 選 `admins`，文件 ID 貼上剛剛複製的 uid，內容留空物件 `{}` 即可
4. 重新整理 `admin/index.html`，應該就能正常進入後台了

### 8. 本機測試
```bash
python3 -m http.server 8080
```
瀏覽器打開 `http://localhost:8080`。

### 9. 部署到 GitHub Pages
push 上 GitHub 後，Settings → Pages 選擇分支即可。

## 重要文件

- **功能規格書**（Word 檔）：完整功能清單、資料結構、待確認事項
- **任務頁面通訊介面規格.md**：任務開發者對接平台的完整協定文件，內含可直接複製的範例程式碼
- **firestore.rules**：資料庫安全規則，任何欄位異動邏輯有疑問都應該回頭對照這份檔案

## 已知限制（誠實揭露，並非程式錯誤）

- **免費方案限制**：沒有 Cloud Functions，金幣防竄改改用 Firestore 規則 + 每日獎勵上限機制，
  無法百分之百防止使用者偽造任務完成，風險已控制在每個任務每日的上限範圍內（詳見規格書第8章）
- **密碼救援**：平台不收集個人資料，因此無法提供密碼救回服務，這是刻意的設計取捨
- **管理後台**：介面走純功能性風格，未套用前台的漸層視覺設計
- **money 尚未實測**：`firestore.rules` 因沙盒環境網路限制無法連上 Firebase Emulator 實際跑過測試，
  部署前務必自行用 emulator 驗證

## 待你補上的內容

- `js/firebase-config.js` 的 `firebaseConfig` 六個欄位
- `admins/{你的uid}` 白名單文件
- 各任務實際的 HTML 檔案（目前 `tasks/sample-task.html` 只是示範／可先用它測試整條流程）
- 各任務在後台設定的 `entryCost`、`dailyRewardCap` 實際數值（seed.js 裡的是示範用預設值）
