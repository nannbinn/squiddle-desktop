# Squiddle 星空鼓手（桌面版）

像素风鱿鱼用触手打架子鼓。Electron 打包成 Windows 10/11 64 位程序。

## 开发

```bash
npm ci
npm run prepare-web   # 把 three.js 和字体拷进 app/vendor（离线可用）
npm start             # 本地运行
xvfb-run -a -s "-screen 0 1400x1000x24" node scripts/smoke.js out/smoke   # 冒烟测试（Linux 无显示器时）
```

## 结构

- `app/js/stage.js`：舞台（Three.js 画面、触手动画、鼓声合成、MIDI / 鼓谱 / 音频解析、星轨）。对界面只开放 `window.Squiddle` 接口（播放、跳转、换歌、读文件、音量等）和事件（`state`、`song`、`lib`、`hit`、`aim`、`camera`、`job`、`msg`），接口说明见文件末尾。
- `app/js/ui.js` + `app/css/ui.css`：界面（自绘标题栏、播放条和像素进度条、右侧抽屉、文字显影、ASCII 动画、开场）。
- `electron/`：无边框窗口、标题栏按钮的 IPC、屏蔽外网请求。
- `design/ui-mockup/`：界面定稿小样。
- `web/index-jelly.html`：网页版原稿，仅作对照。

快捷键：空格 播放/暂停，M 菜单，1 / 2 / 3 切页，Esc 收起菜单或退出全屏，F11 全屏，Ctrl+O 打开文件，F12 开发者工具。

## 打包

- `npm run dist`：安装版 `Squiddle-Setup-<版本>.exe` + 免安装版 `Squiddle-<版本>-portable.exe`（需在 Windows 上，或 Linux 装 32 位 wine）
- `npm run dist:zip`：解压即用的 `Squiddle-<版本>-win-x64.zip`（Linux 上也能打）
- 推送到 GitHub 后，Actions 在 Windows 机器上自动打包；打 `v*` 标签会发布到 Releases。

## 第三方

- three.js r128（MIT）
- 字体 Silkscreen、Fusion Pixel 12px（缝合像素字体）、VT323（SIL Open Font License，见 app/vendor/fonts/*-LICENSE.txt）
