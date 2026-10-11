#!/usr/bin/env bash
# 안드로이드 APK 빌드 (Android Studio/Gradle 없이 Ubuntu 패키지 도구만 사용)
#
#   sudo apt-get install -y aapt apksigner zipalign dalvik-exchange android-sdk-platform-23 openjdk-17-jdk-headless
#   ./android/build.sh            → android/build/summerolympic.apk
#
# 웹 게임 파일(index.html, shared/, games/, olympic/, icons/)을 그대로 assets/www 에 넣는다.
# 새 종목을 추가해도 이 스크립트는 고칠 필요 없음 — 다시 실행만 하면 된다.
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(dirname "$HERE")"
OUT="$HERE/build"
SDK="${ANDROID_JAR:-/usr/lib/android-sdk/platforms/android-23/android.jar}"
KEYSTORE="$HERE/debug.keystore"   # 같은 키로 서명해야 덮어쓰기 업데이트가 된다

for tool in aapt zipalign apksigner javac; do
  command -v "$tool" >/dev/null || { echo "필요한 도구가 없습니다: $tool (파일 맨 위의 apt-get 명령을 실행하세요)" >&2; exit 1; }
done
DX="$(command -v dx || echo /usr/lib/android-sdk/build-tools/debian/dx)"
[ -x "$DX" ] || { echo "dx 가 없습니다 (dalvik-exchange 설치)" >&2; exit 1; }
[ -f "$SDK" ] || { echo "android.jar 가 없습니다: $SDK" >&2; exit 1; }

rm -rf "$OUT"
mkdir -p "$OUT/gen" "$OUT/classes" "$OUT/assets/www"

echo "== 게임 파일 복사"
cp "$ROOT/index.html" "$ROOT/manifest.webmanifest" "$OUT/assets/www/"
cp -r "$ROOT/shared" "$ROOT/games" "$ROOT/olympic" "$ROOT/icons" "$OUT/assets/www/"

echo "== 리소스 (R.java)"
aapt package -f -m -J "$OUT/gen" -M "$HERE/AndroidManifest.xml" -S "$HERE/res" -I "$SDK"

echo "== 자바 컴파일"
find "$HERE/src" "$OUT/gen" -name '*.java' > "$OUT/sources.txt"
javac -nowarn -encoding UTF-8 --release 8 -classpath "$SDK" -d "$OUT/classes" @"$OUT/sources.txt" 2>&1 \
  | grep -v "^warning: \[options\]" || true
[ -f "$OUT/classes/com/grehful/summerolympic/MainActivity.class" ] || { echo "컴파일 실패" >&2; exit 1; }

echo "== dex 변환"
"$DX" --dex --min-sdk-version=26 --output="$OUT/classes.dex" "$OUT/classes"

echo "== APK 묶기"
aapt package -f -M "$HERE/AndroidManifest.xml" -S "$HERE/res" -A "$OUT/assets" -I "$SDK" \
  -F "$OUT/unsigned.apk"
(cd "$OUT" && aapt add unsigned.apk classes.dex >/dev/null)
zipalign -f 4 "$OUT/unsigned.apk" "$OUT/aligned.apk"

echo "== 서명"
if [ ! -f "$KEYSTORE" ]; then
  keytool -genkeypair -keystore "$KEYSTORE" -storepass android -keypass android -alias androiddebugkey \
    -keyalg RSA -keysize 2048 -validity 10000 -dname "CN=Android Debug,O=Android,C=US" >/dev/null 2>&1
fi
apksigner sign --ks "$KEYSTORE" --ks-pass pass:android --key-pass pass:android \
  --min-sdk-version 26 --out "$OUT/summerolympic.apk" "$OUT/aligned.apk"
apksigner verify "$OUT/summerolympic.apk"

echo "완료: $OUT/summerolympic.apk ($(du -h "$OUT/summerolympic.apk" | cut -f1))"
