#!/bin/sh
set -eu
source_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
output=${1:-"$source_dir/build/剧爆棚图片工作端.app"}
if [ -e "$output" ] || [ -L "$output" ]; then
  echo "目标已存在，请提供新的构建路径。" >&2
  exit 1
fi
mkdir -p "$output/Contents/MacOS" "$output/Contents/Resources"
mkdir -p "$source_dir/build/ModuleCache"
swiftc -O -target "$(uname -m)-apple-macos13.0" -module-cache-path "$source_dir/build/ModuleCache" -framework Cocoa -framework Security -framework UniformTypeIdentifiers "$source_dir/App.swift" -o "$output/Contents/MacOS/JubaopengImageWorker"
cp "$source_dir/worker.mjs" "$output/Contents/Resources/worker.mjs"
cp "$source_dir/../mac-video-test/video-smoke.mjs" "$output/Contents/Resources/video-smoke.mjs"
cat > "$output/Contents/Info.plist" <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>CFBundleExecutable</key><string>JubaopengImageWorker</string>
<key>CFBundleIdentifier</key><string>com.jubaopeng.image-worker</string>
<key>CFBundleName</key><string>剧爆棚图片工作端</string>
<key>CFBundleDisplayName</key><string>剧爆棚图片工作端</string>
<key>CFBundleVersion</key><string>1</string>
<key>CFBundleShortVersionString</key><string>1.0</string>
<key>CFBundlePackageType</key><string>APPL</string>
<key>LSMinimumSystemVersion</key><string>13.0</string>
<key>NSHighResolutionCapable</key><true/>
</dict></plist>
PLIST
codesign --force --deep --sign - "$output"
printf '%s\n' "$output"
