# Squiddle 星空鼓手（桌面版）

像素风鱿鱼用触手打架子鼓。Electron 打包成 Windows 10/11 64 位程序。

## 开发

```bash
npm ci
npm run prepare-web   # 由 web/index-jelly.html 生成 app/index.html，three.js 和字体改为本地
npm start             # 本地运行
```

## 打包

- `npm run dist`：安装版 `Squiddle-Setup-<版本>.exe` + 免安装版 `Squiddle-<版本>-portable.exe`（需在 Windows 上，或 Linux 装 32 位 wine）
- `npm run dist:zip`：解压即用的 `Squiddle-<版本>-win-x64.zip`（Linux 上也能打）
- 推送到 GitHub 后，Actions 在 Windows 机器上自动打包；打 `v*` 标签会发布到 Releases。

## 第三方

- three.js r128（MIT）
- 字体 Silkscreen、站酷庆科黄油体（SIL Open Font License，见 app/vendor/fonts/*-LICENSE.txt）
