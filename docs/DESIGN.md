# Squiddle 星空鼓手 · 设计说明

> 基于 `ui-v3`（cc826e4，v0.3.0）。行号会随改动漂移，以函数名/常量名为准，用 `grep -n` 重新定位。
> 页面很大（`stage.js` 约 3000 行），请按下面的位置局部搜索、局部修改，不要整文件通读。

## 1. 视觉共识
- **主角**：粉色半透明果冻鱿鱼 + 厚壳轮廓（后处理“壳”：深梅描边 → 粉白亮线 → 壁色）。渐变：头部粉 → 中部淡紫 → 触手尖深紫红。配色在 `PAL`，材质 `jellyMat`。
- **鼓**：深靛蓝星空闪粉；底鼓前皮金圈 + 黄色四芒星。低音单元音箱，声波圈只从低音喇叭发（`ampRing`）。
- **披肩**：星空长披肩，6 片 V 形长襟 + 金流苏 + 宝石扣；领口是喇叭形外翻小高领，无尖角、不穿过眼睛。Verlet 布（`updateCape`），常量 `CAPE_*`。
- **页面**：统一深靛蓝星空（`--night #1f2263`），分割线 1px 亮线 `--hair #a39de6`；界面框线用 logo 粉 `#f083a5`。**近黑深色版被否**，别用。
- **标题**：Squiddle，加粗像素斜衬线（Playfair 斜体点阵烘焙，粉→淡紫渐变）。
- **字体**：中文 Fusion Pixel 12px，logo Silkscreen，ASCII VT323；不再用站酷字体。
- **聚光灯**（默认关）：斜射、呼吸应援灯；开灯后夜景远处淡紫峰林剪影 + 城堡（别用深色），星星钉在天空随视角转并轻闪。**地板保持原样**（花纹版被否）。
- **进度条**：平时 2px 细粒子线；悬停变像素格；拖动时滑块格 + 左右各一格放大，拖过的格慢慢收回，鼠标离开直接收细。
- **界面干净**：不加说明文字、无三维轴、无自动运镜（导演模式默认关）。

## 2. 节奏 / 交互共识
- 碰撞实时发声；底鼓腕只在竖直面里弯成 J 形，从下往上拍。
- 可上传歌 / MIDI（GM 第 10 通道）/ 文本鼓谱自动演奏；无鼓轨则自动编（`arrange`）。
- **暂停时点鼓只打一下**，不自动播放、进度不动；播放时点鼓只改下一下的落点。
- 参数 / 曲目 / “刚才这一下”收进播放器“菜单”。
- 动画一律按 dt 写，不按帧（`FDT`、`perFrame`）；鼓皮固定每秒 180 步。
- 会记住：拖入的歌/MIDI/鼓谱（IndexedDB）、上次曲目、循环、导演、聚光灯、音量、帧率上限、页签（localStorage，键前缀 `squiddle.`）。

## 3. 核心文件
| 文件 | 作用 |
|---|---|
| `app/js/stage.js` | 舞台：Three.js 画面、触手、鼓声合成、MIDI/鼓谱/音频解析、星轨。对外只有 `window.Squiddle` 与事件总线 |
| `app/js/ui.js` + `app/css/ui.css` | 界面：标题栏、播放条、进度条、抽屉、粒子、开场字符显影 |
| `app/index.html` | 页面骨架 |
| `electron/main.js`, `preload.js` | 无边框窗口、IPC、屏蔽外网；mac 用系统红绿灯 + 最小菜单 |
| `scripts/` | `prepare.js` 拷字体/three；`build-web.js` 出单文件网页；`smoke.js` 冒烟；`zip-win.js` |
| `web/index-jelly.html` | 网页版原稿，仅对照 |

## 4. `stage.js` 定位表（grep 这些名字）
| 内容 | 位置 |
|---|---|
| 夜景着色器（`castle()`、`ridge()` 峰林，后处理里） | ~L108–175 |
| 太阳方向 `SUN_DIR`、阴影设置 | L245，~L248–252 |
| 聚光灯 `SPOT`、`updateSpot` | L278，L306 |
| 视角：`ORBIT0`、`clampTarget`、`applyOrbit` | L324，L353 |
| 果冻配色 `PAL`、材质 `jellyMat`、`organMat` | L454，L457，L525 |
| 星形装饰 `starGeo`、器官 `updateOrgans`、眼睛 `updateEyes` | L703，L774，L818 |
| 触手 `updateArms`（总控）、`makeLimb`/`solveIK`/`drawLimb`/`collideLimb` | L852，L1568+ |
| 披肩 `CAPE_*` 常量、`updateCape` | L924，L1026 |
| 鼓 `makeDrum`、鼓皮 `stepMembrane`/`strikeMembrane` | L1091，L1151 |
| 镲 `makeCymbal`；音箱 `makeStack`/`makeBassCab`；声波 `ampRing` | L1204，L1354，L1416 |
| 音频：`initAudio`、`playDrum`、`playCymbal` | L1490，L1509，L1537 |
| **打击节奏参数**：`FDT`、`perFrame`、`LEAD`、`MIN_GAP`、`REARM`、`LIFT0`、`HIT_DEF` | L1799–1804 |
| 谱面：`buildLanes`、`prepSong`、`applySong`、`advanceSong` | L1810，L1833，L1856，L1880 |
| 打点调度：`scheduleNext`、`computeTarget`、`onContact`、`checkContact` | L1906，L1927，L1991，L2016 |
| 角色主循环 `updateCharacter`；导演镜头 `pickShot`/`dirHit`/`updateCamera` | L2051，L2142，L2165，L2182 |
| 帧循环 `frame`（含帧率上限 `CAP`、鼓皮 `memAcc`） | L2208 |
| 播放控制：`setPlaying`/`seekTo`/`setSpeed`/`setDrumVol`/`setTune` | L2298–2337 |
| 星轨 `drawLane` | L2363 |
| 曲目：`loadSong`、`handleFile`、`parseTab`、`parseMidi`、`arrange` | L2432，L2466，L2515，L2560，L2626 |
| **性能 `OPT`**：静止零件合并、静态影子只算一次 | L2845 起 |
| **记忆 `SAVE`**（IndexedDB） | ~L2950 |
| 对外接口 `window.Squiddle = {…}` | L3009 |

## 5. `ui.js` 定位表
| 内容 | 位置 |
|---|---|
| 本地存储封装 `squiddle.*` | L12 |
| 文字显影 `reveal` | L24 |
| 像素进度条 `setBar`（格宽：平时 3px / 悬停 7px / 拖动放大） | L106 |
| 拖动暂停再继续 `scrubStart/End` | L121 |
| 星轨拖动/点击跳转 | L125–145 |
| 菜单/页签 `openMenu`、`selectTab`、`fitPanes` | L167–200 |
| 曲目列表 `renderLib` | L206 |
| 圆形粒子鼓皮 `drawHead`、点阵频谱 `drawSpec` | L335，L371 |
| 全窗口粒子 `emitFx`、`drawFx` | L424，L490 |
| 进度条放大 `drawMag`、光流 `seekEmber` | L441，L470 |
| 开场字符显影 `splash`…`runSplash`/`waitStart`/`done` | L527–850 |
| 每帧 `frame` | L860 |

## 6. 工作约定
- 微调按主题新开串；不自动打安装包、不自动截图对比、不远程操控用户的 Mac，需要预览时告知用户自己运行。
- 冒烟测试：`xvfb-run -a -s "-screen 0 1400x1000x24" node scripts/smoke.js out/smoke`。
- 打包与命令见根目录 `README.md`。
