<p align="right"><a href="../EXTENDING.md">English</a> · <a href="../zh-TW/EXTENDING.md">繁體中文</a> · <b>简体中文</b></p>

# 扩充指南

ReelMimic 的扩充点由浅到深：

| 想做的事 | 改哪里 | 要改程序吗 |
|---|---|---|
| 加一种视频风格 | `.claude/skills/video-clone/styles/<name>.md` | 不用 |
| 加一个制作引擎（新的画法／渲染方式） | `.claude/skills/<engine>/`（一般 agent skill） | 不用 |
| 调整 agent 在某一步怎么做 | `app/server/prompts.ts` | 只改文本，下一轮就生效 |
| 加新工具给 agent 用 | `.claude/skills/video-clone/scripts/` | 写脚本，再在 prompt／SKILL.md 提到它 |
| 接另一种 AI 导演（新的 agent CLI） | `app/server/agents/index.ts` | 要 |
| 改生产线的步骤或顺序 | `app/server/`（见第 5 节）+ `prompts.ts` + `CONTRACT.md` | 要 |

---

## 1. 加一种风格

风格＝「看到什么样的参考片 → 用哪个引擎、用什么默认去做」。导演在 styling 步骤会读 `styles/` 底下所有文件，用「辨识特征」比对参考片，
挑出最符合的一个写进 `analysis/route.json`。

1. 拷贝 `styles/_TEMPLATE.md` 成 `styles/<name>.md`。
2. 填 frontmatter：

   ```yaml
   ---
   name: lofi-anime-loop        # 唯一代号，和文件名相同
   engine: hyperframes          # .claude/skills/ 底下的文件夹名
   medium: 2d-vector            # 2d-painted · 2d-vector · 3d-stylized · 3d-photoreal（选引擎的硬条件）
   priority: 60                 # 两种风格都符合时，大的优先
   ---
   ```
3. 写三段：
   - **辨识特征**：画面、剪接、声音、文本各一两句，写「看得到、量得到」的东西（例：平均镜头 2–3 秒、切点跟旁白不跟拍子）。
   - **制作默认**：比例、长度、fps、角色怎么做（例：2D 矢量角色一律用 `assets/vector_rig`）、字幕规格。
   - **已知的坑**：做过之后踩到的问题与解法。每次制作学到新东西就补在这里，下一支片会自动避开。
4. 用一支代表性的参考片建项目，确认 `analysis/route.json` 选到你的风格。

不想让某个风格参与选择时，把文件移到 `styles/_disabled/`。

## 2. 加一个制作引擎

引擎就是一般的 agent skill：一个文件夹，里面有 `SKILL.md`（给 agent 的使用说明）和它需要的脚本、范本。

```
.claude/skills/my-engine/
  SKILL.md          frontmatter（name、description）＋ 怎么建项目、怎么预览单格、怎么输出 MP4、规则与已知的坑
  scripts/ …        渲染、预览工具
  template/ …       新项目骨架（选配）
```

让它能接进生产线，`SKILL.md` 要讲清楚这几件事（setup 步骤的导演会照着建 `build/production.json`）：

- **每个镜头一个文件**：多个制作 agent 平行时只改自己的档，不会互相冲突。
- **共用档**：角色定义、配色、字幕层、音频放在共用档；镜头只调用、不重画角色的身体部位。
- **预览指令**：怎么快速渲染某个时间点的单格与裁切（审查全靠它）。HyperFrames 项目可直接用 `scripts/hf_frames.py`。
- **输出指令**：怎么渲染整支 MP4、怎么混音。
- **确定性**：每一格都只由时间决定（不要用 `Math.random()` 或跨格状态），才能平行渲染、跳格审查。

然后写一个指向它的风格档（上一节）。第三方 skill 放进来前，请先看过它的脚本，并把授权补进 `THIRD_PARTY_NOTICES.md`。

### 从引擎骨架开始

`.claude/skills/video-clone/assets/engine-kit/` 是做新画法最快的起点：像素风、剪纸、白板、动漫四个引擎都建在它上面。里面有共用的运行环境（时间轴、动作函数、镜头、字幕与渲染界面）、无头 Chrome 的 `render.mjs`、页面范本、`new_project.sh`，以及当初做这些引擎用的检查清单 `ENGINE_BRIEF.md`。拷贝到 `.claude/skills/<你的引擎>/template/`，写好画法函数库和角色，就直接有平行渲染、审查用的总览图与裁切、可续跑的输出。

### 角色系统

- `assets/vector_rig/`：2D 矢量角色，骨架（脖子、肩、肘、腕、髋、膝）＋每个深度层只描一次外框，四肢永远接在身上。用法见其 README。
- `assets/cast_rig.js`：painted-animation（水彩手绘）用的角色骨架。

新引擎若有自己的角色做法，请一样遵守「角色定义在共用档、每个角色一个档、镜头只给姿势参数」，角色关才能平行审查与修正。

## 3. 调整 agent 的做法（prompts.mjs）

`app/server/prompts.ts` 每个键对应生产线的一步：

| 键 | 谁 | 做什么 |
|---|---|---|
| `style` · `plan` · `replan` | 导演 | 选风格、写企划内核、依意见修改 |
| `pre_cast` · `pre_assets` · `plan_frames` | 角色 · 素材 · 导演 | 前制平行：每个角色的草稿、抓素材、集成并画定调画面 |
| `setup` | 导演 | 建引擎项目、共用档、角色、分段 |
| `cast_qa` · `cast_fix` | 审查员 · 修正 | 角色关 |
| `build_chunk` · `shot_qa` · `fix_chunk` | 制作 · 审查员 · 制作 | 分段制作；每一镜做完由一个审查员审（`shots`/`out` 参数指定镜头与输出档） |
| `shared_fix` | 导演 | 制作 agent 回报的共用档问题 |
| `assemble` · `critique` · `revise` | 导演 · 评审 · 导演 | 组装、最后评审、修改 |

共用片段：`RULES`（内容与授权原则）、`SPEED`（效率规则）、`EYE`（人眼检查清单）、`QA_OUT`（审查输出格式与 blocker/polish 定义）。
服务器每次派工前都会检查这个档有没有改过，**改完下一轮 agent 就用新指令，不用重启**。

建议做法：先用 `python .claude/skills/video-clone/scripts/timeline.py projects/<id>` 看时间花在哪、哪一关反复退回，再决定改哪段指令。
把「最后评审常退回的东西」往前移到 setup 或 build 阶段定成规格，是最有效的提速方式。

## 4. 接另一种 AI 导演

在 `app/server/agents/index.ts`：

1. 写一个 `xxxArgs(sessionId, cwd)`：无交互、自动核准文件修改、可接续 session 的命令行参数。
2. 写一个 `parseXxx(obj, emit, st)`：把 CLI 的 JSON 串流转成统一事件：
   `session {id}`、`text {text}`、`thinking {text}`、`tool {name, detail}`、`error {text}`，最后 `done {ok, text}`。
3. 在 `runAgent` 与 `agentStatus` 加上新的 `kind`，前端 `App.tsx` 的选择器加一个选项。

agent 需要能：读写 repo 内文件、运行 shell（python、node、ffmpeg）、看图片（审查靠它）、接续对话。

## 5. 改生产线

`app/server/` 里各部分的位置：

- `preprod.ts` — `preProduction()`：企划核心 → 角色与素材平行 → 风格画面。
- `production.ts` — `production()`：setup → `castGate()`（与分段制作同时跑）→ `runChunk()` × N → assemble。
- `cast.ts` — `castGate()` / `castSerial()`：每个角色平行审查修正；一个角色或共用档时走串行版。
- `final.ts` — `finalPanel()`：最后评审 ⇄ 修改。
- `review.ts` — `reviewFix()`：上面每一关共用的「审查 → 修正」循环。新的关卡只要给 `review`、`verdict`、`limit`、`fix`，轮数、暂停、到上限停下都由循环处理。
- `turn.ts` — `turn()`：派一次 agent 回合（session 管理、全局名额、必须文件检查、失败原因）；`step()` 是会推进阶段的回合。
- `jobs.ts` — 用户的操作，每一个都是这个项目唯一的一条流程（`runner.ts`），所以「取消」能停掉全部。

改步骤时三个地方要一起改：上面对应的流程文件、`prompts.ts`（指令）、`CONTRACT.md`（新文件的格式；服务器会读来做判断的话，在 `contract.ts` 加上它的格式），前端要显示的话再改 `Project.tsx`。
参数（平行数、每关轮数）在 `CONFIG`，也可以用环境变量调整。

## 6. 界面文本与翻译

组件里的界面文本一律写繁體中文。`app/web/src/i18n.ts` 在运行时翻译整个页面：英文来自 `EN` 对照表（含数字的字符串用 `EN_RE` 样式），简体中文由 OpenCC 自动转换。
添加文本时请在 `EN` 补上英文；不该被翻译的元素（用户内容、文件名）加 `data-no-i18n`。

## 7. 开发

```bash
cd app
npm run server      # 只跑后端（改 server/ 后重启：bash app/restart.sh）
npm run web         # 前端开发服务器 http://localhost:5173（熱更新，/api 转到 4318）
npm run build       # 输出 app/dist，给 npm start / start.sh 用
npm run doctor      # 环境检查
```

小型测试：`_smoke/`（本机，不进版本控制）放过单一组件的验证页；完整验证就是实际跑一支 30 秒短片，然后用 `timeline.py` 看时间、逐格看成片。
