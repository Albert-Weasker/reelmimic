<p align="right"><a href="../EXTENDING.md">English</a> · <b>繁體中文</b> · <a href="../zh-CN/EXTENDING.md">简体中文</a></p>

# 擴充指南

ReelMimic 的擴充點由淺到深：

| 想做的事 | 改哪裡 | 要改程式嗎 |
|---|---|---|
| 加一種影片風格 | `.claude/skills/video-clone/styles/<name>.md` | 不用 |
| 加一個製作引擎（新的畫法／渲染方式） | `.claude/skills/<engine>/`（一般 agent skill） | 不用 |
| 調整 agent 在某一步怎麼做 | `app/server/prompts.ts` | 只改文字，下一輪就生效 |
| 加新工具給 agent 用 | `.claude/skills/video-clone/scripts/` | 寫腳本，再在 prompt／SKILL.md 提到它 |
| 接另一種 AI 導演（新的 agent CLI） | `app/server/agents/index.ts` | 要 |
| 改生產線的步驟或順序 | `app/server/`（見第 5 節）+ `prompts.ts` + `CONTRACT.md` | 要 |

---

## 1. 加一種風格

風格＝「看到什麼樣的參考片 → 用哪個引擎、用什麼預設去做」。導演在 styling 步驟會讀 `styles/` 底下所有檔案，用「辨識特徵」比對參考片，
挑出最符合的一個寫進 `analysis/route.json`。

1. 複製 `styles/_TEMPLATE.md` 成 `styles/<name>.md`。
2. 填 frontmatter：

   ```yaml
   ---
   name: lofi-anime-loop        # 唯一代號，和檔名相同
   engine: hyperframes          # .claude/skills/ 底下的資料夾名
   medium: 2d-vector            # 2d-painted · 2d-vector · 3d-stylized · 3d-photoreal（選引擎的硬條件）
   priority: 60                 # 兩種風格都符合時，大的優先
   ---
   ```
3. 寫三段：
   - **辨識特徵**：畫面、剪接、聲音、文字各一兩句，寫「看得到、量得到」的東西（例：平均鏡頭 2–3 秒、切點跟旁白不跟拍子）。
   - **製作預設**：比例、長度、fps、角色怎麼做（例：2D 向量角色一律用 `assets/vector_rig`）、字幕規格。
   - **已知的坑**：做過之後踩到的問題與解法。每次製作學到新東西就補在這裡，下一支片會自動避開。
4. 用一支代表性的參考片建專案，確認 `analysis/route.json` 選到你的風格。

不想讓某個風格參與選擇時，把檔案移到 `styles/_disabled/`。

## 2. 加一個製作引擎

引擎就是一般的 agent skill：一個資料夾，裡面有 `SKILL.md`（給 agent 的使用說明）和它需要的腳本、範本。

```
.claude/skills/my-engine/
  SKILL.md          frontmatter（name、description）＋ 怎麼建專案、怎麼預覽單格、怎麼輸出 MP4、規則與已知的坑
  scripts/ …        渲染、預覽工具
  template/ …       新專案骨架（選配）
```

讓它能接進生產線，`SKILL.md` 要講清楚這幾件事（setup 步驟的導演會照著建 `build/production.json`）：

- **每個鏡頭一個檔案**：多個製作 agent 平行時只改自己的檔，不會互相衝突。
- **共用檔**：角色定義、配色、字幕層、音訊放在共用檔；鏡頭只呼叫、不重畫角色的身體部位。
- **預覽指令**：怎麼快速渲染某個時間點的單格與裁切（審查全靠它）。HyperFrames 專案可直接用 `scripts/hf_frames.py`。
- **輸出指令**：怎麼渲染整支 MP4、怎麼混音。
- **確定性**：每一格都只由時間決定（不要用 `Math.random()` 或跨格狀態），才能平行渲染、跳格審查。

然後寫一個指向它的風格檔（上一節）。第三方 skill 放進來前，請先看過它的腳本，並把授權補進 `THIRD_PARTY_NOTICES.md`。

### 從引擎骨架開始

`.claude/skills/video-clone/assets/engine-kit/` 是做新畫法最快的起點：像素風、剪紙、白板、動漫四個引擎都建在它上面。裡面有共用的執行環境（時間軸、動作函式、鏡頭、字幕與渲染介面）、無頭 Chrome 的 `render.mjs`、頁面範本、`new_project.sh`，以及當初做這些引擎用的檢查清單 `ENGINE_BRIEF.md`。複製到 `.claude/skills/<你的引擎>/template/`，寫好畫法函式庫和角色，就直接有平行渲染、審查用的總覽圖與裁切、可續跑的輸出。

### 角色系統

- `assets/vector_rig/`：2D 向量角色，骨架（脖子、肩、肘、腕、髖、膝）＋每個深度層只描一次外框，四肢永遠接在身上。用法見其 README。
- `assets/cast_rig.js`：painted-animation（水彩手繪）用的角色骨架。

新引擎若有自己的角色做法，請一樣遵守「角色定義在共用檔、每個角色一個檔、鏡頭只給姿勢參數」，角色關才能平行審查與修正。

## 3. 調整 agent 的做法（prompts.mjs）

`app/server/prompts.ts` 每個鍵對應生產線的一步：

| 鍵 | 誰 | 做什麼 |
|---|---|---|
| `style` · `plan` · `replan` | 導演 | 選風格、寫企劃核心、依意見修改 |
| `pre_cast` · `pre_assets` · `plan_frames` | 角色 · 素材 · 導演 | 前製平行：每個角色的草稿、抓素材、整合並畫定調畫面 |
| `setup` | 導演 | 建引擎專案、共用檔、角色、分段 |
| `cast_qa` · `cast_fix` | 審查員 · 修正 | 角色關 |
| `build_chunk` · `shot_qa` · `fix_chunk` | 製作 · 審查員 · 製作 | 分段製作；每一鏡做完由一個審查員審（`shots`/`out` 參數指定鏡頭與輸出檔） |
| `shared_fix` | 導演 | 製作 agent 回報的共用檔問題 |
| `assemble` · `critique` · `revise` | 導演 · 評審 · 導演 | 組裝、最後評審、修改 |

共用片段：`RULES`（內容與授權原則）、`SPEED`（效率規則）、`EYE`（人眼檢查清單）、`QA_OUT`（審查輸出格式與 blocker/polish 定義）。
伺服器每次派工前都會檢查這個檔有沒有改過，**改完下一輪 agent 就用新指令，不用重啟**。

建議做法：先用 `python .claude/skills/video-clone/scripts/timeline.py projects/<id>` 看時間花在哪、哪一關反覆退回，再決定改哪段指令。
把「最後評審常退回的東西」往前移到 setup 或 build 階段定成規格，是最有效的提速方式。

## 4. 接另一種 AI 導演

在 `app/server/agents/index.ts`：

1. 寫一個 `xxxArgs(sessionId, cwd)`：無互動、自動核准檔案修改、可接續 session 的命令列參數。
2. 寫一個 `parseXxx(obj, emit, st)`：把 CLI 的 JSON 串流轉成統一事件：
   `session {id}`、`text {text}`、`thinking {text}`、`tool {name, detail}`、`error {text}`，最後 `done {ok, text}`。
3. 在 `runAgent` 與 `agentStatus` 加上新的 `kind`，前端 `App.tsx` 的選擇器加一個選項。

agent 需要能：讀寫 repo 內檔案、執行 shell（python、node、ffmpeg）、看圖片（審查靠它）、接續對話。

## 5. 改生產線

`app/server/` 裡各部分的位置：

- `preprod.ts` — `preProduction()`：企劃核心 → 角色與素材平行 → 風格畫面。
- `production.ts` — `production()`：setup → `castGate()`（與分段製作同時跑）→ `runChunk()` × N → assemble。
- `cast.ts` — `castGate()` / `castSerial()`：每個角色平行審查修正；一個角色或共用檔時走序列版。
- `final.ts` — `finalPanel()`：最後評審 ⇄ 修改。
- `review.ts` — `reviewFix()`：上面每一關共用的「審查 → 修正」迴圈。新的關卡只要給 `review`、`verdict`、`limit`、`fix`，輪數、暫停、到上限停下都由迴圈處理。
- `turn.ts` — `turn()`：派一次 agent 回合（session 管理、全域名額、必須檔案檢查、失敗原因）；`step()` 是會推進階段的回合。
- `jobs.ts` — 使用者的操作，每一個都是這個專案唯一的一條流程（`runner.ts`），所以「取消」能停掉全部。

改步驟時三個地方要一起改：上面對應的流程檔、`prompts.ts`（指令）、`CONTRACT.md`（新檔案的格式；伺服器會讀來做判斷的話，在 `contract.ts` 加上它的格式），前端要顯示的話再改 `Project.tsx`。
參數（平行數、每關輪數）在 `CONFIG`，也可以用環境變數調整。

## 6. 介面文字與翻譯

元件裡的介面文字一律寫繁體中文。`app/web/src/i18n.ts` 在執行時翻譯整個頁面：英文來自 `EN` 對照表（含數字的字串用 `EN_RE` 樣式），簡體中文由 OpenCC 自動轉換。
新增文字時請在 `EN` 補上英文；不該被翻譯的元素（使用者內容、檔名）加 `data-no-i18n`。

## 7. 開發

```bash
cd app
npm run server      # 只跑後端（改 server/ 後重啟：bash app/restart.sh）
npm run web         # 前端開發伺服器 http://localhost:5173（熱更新，/api 轉到 4318）
npm run build       # 輸出 app/dist，給 npm start / start.sh 用
npm run doctor      # 環境檢查
```

小型測試：`_smoke/`（本機，不進版本控制）放過單一元件的驗證頁；完整驗證就是實際跑一支 30 秒短片，然後用 `timeline.py` 看時間、逐格看成片。
