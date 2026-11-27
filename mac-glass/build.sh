#!/bin/zsh
# 打包 Mac 原生玻璃外壳版 Squiddle.app（Swift + 系统 WebKit，约 2 MB）：外壳 + 仓库 app/ 里的网页（只拷贝，不改 app/）
# 需要 macOS 26 SDK（Xcode 26 / 命令行工具）。先跑 npm run prepare-web 准备 app/vendor。
# 产物：dist/Squiddle-<版本>-mac.dmg 和 .zip（arm64 + x86_64 通用，临时签名）
set -euo pipefail
HERE=${0:A:h}
ROOT=$HERE/..
OUT=$ROOT/dist
WORK=$OUT/mac-glass
APP="$WORK/Squiddle.app"
VER=$(node -p "require('$ROOT/package.json').version")

rm -rf "$WORK"; mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"

for arch in arm64 x86_64; do
  swiftc -O -swift-version 5 -target $arch-apple-macos26.0 \
    -module-cache-path "$WORK/module-cache" \
    -framework AppKit -framework WebKit \
    "$HERE/main.swift" -o "$WORK/SquiddleGlass-$arch"
done
lipo -create "$WORK/SquiddleGlass-arm64" "$WORK/SquiddleGlass-x86_64" -output "$APP/Contents/MacOS/SquiddleGlass"
chmod +x "$APP/Contents/MacOS/SquiddleGlass"

ditto --norsrc "$ROOT/app" "$APP/Contents/Resources/app"
find "$APP/Contents/Resources/app" -name .DS_Store -delete
ditto "$HERE/shell" "$APP/Contents/Resources/shell"

# 图标：由 build/icon-mac.png（1024）生成 icns
ICONSET="$WORK/icon.iconset"; mkdir -p "$ICONSET"
for s in 16 32 128 256 512; do
  sips -z $s $s "$ROOT/build/icon-mac.png" --out "$ICONSET/icon_${s}x${s}.png" >/dev/null
  sips -z $((s*2)) $((s*2)) "$ROOT/build/icon-mac.png" --out "$ICONSET/icon_${s}x${s}@2x.png" >/dev/null
done
iconutil -c icns "$ICONSET" -o "$APP/Contents/Resources/icon.icns"

cat > "$APP/Contents/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>CFBundleExecutable</key><string>SquiddleGlass</string>
  <key>CFBundleIdentifier</key><string>app.squiddle.glass</string>
  <key>CFBundleName</key><string>Squiddle</string>
  <key>CFBundleDisplayName</key><string>Squiddle</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleShortVersionString</key><string>$VER</string>
  <key>CFBundleVersion</key><string>$VER</string>
  <key>CFBundleIconFile</key><string>icon</string>
  <key>CFBundleDevelopmentRegion</key><string>zh_CN</string>
  <key>LSMinimumSystemVersion</key><string>26.0</string>
  <key>LSApplicationCategoryType</key><string>public.app-category.music</string>
  <key>NSPrincipalClass</key><string>NSApplication</string>
  <key>NSHighResolutionCapable</key><true/>
  <key>NSHumanReadableCopyright</key><string>Squiddle 星空鼓手</string>
</dict></plist>
PLIST

# 没有 Apple 开发者证书：临时签名
codesign --force --deep --sign - "$APP"
codesign --verify --deep --strict "$APP"
du -sh "$APP"

# dmg（带「应用程序」快捷方式，拖进去即可）和 zip
DMGSRC="$WORK/dmg"; mkdir -p "$DMGSRC"
ditto "$APP" "$DMGSRC/Squiddle.app"
ln -s /Applications "$DMGSRC/Applications"
rm -f "$OUT/Squiddle-$VER-mac.dmg" "$OUT/Squiddle-$VER-mac.zip"
hdiutil create -volname "Squiddle" -srcfolder "$DMGSRC" -ov -format UDZO "$OUT/Squiddle-$VER-mac.dmg"
ditto -c -k --keepParent "$APP" "$OUT/Squiddle-$VER-mac.zip"
ls -lh "$OUT"/Squiddle-$VER-mac.*
