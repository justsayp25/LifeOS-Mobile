# Building the LifeOS APK on this PC

Needs: Node (installed), a **JDK 17** (the repo expects a portable one in `.tools/`, see below), and the Android SDK (`%LOCALAPPDATA%\Android\Sdk`, platforms/build-tools/licenses present). Gradle downloads the rest (platform 36, NDK) on the first build.

## One-time: portable JDK 17 (not installed system-wide)
```powershell
mkdir .tools; cd .tools
curl.exe -L -o jdk17.zip "https://api.adoptium.net/v3/binary/latest/17/ga/windows/x64/jdk/hotspot/normal/eclipse"
Expand-Archive jdk17.zip .; cd ..
```
(`.tools/` is git-ignored.) The folder name is like `jdk-17.0.21+9`; adjust below if it differs.

## Build
```powershell
npm install
npx expo prebuild --platform android      # makes android/ from app.json and the plugins
$env:JAVA_HOME = "$PWD\.tools\jdk-17.0.21+9"
$env:ANDROID_HOME = "$env:LOCALAPPDATA\Android\Sdk"
$env:Path = "$env:JAVA_HOME\bin;$env:Path"
Set-Content android\local.properties ("sdk.dir=" + ($env:ANDROID_HOME -replace '\\','/')) -Encoding ascii
cd android
.\gradlew.bat assembleRelease "-PreactNativeArchitectures=arm64-v8a"
```
The APK is at `android\app\build\outputs\apk\release\app-release.apk` (signed with the debug key, fine for installing on your own phone). `arm64-v8a` is the S25+; leave the flag out for all CPU types (bigger, slower build).

## Install on the phone
1. Copy `LifeOS-v1.apk` to the phone (USB cable, or any file transfer), tap it, allow "install from this source" when asked. Or, with USB debugging on: `%LOCALAPPDATA%\Android\Sdk\platform-tools\adb.exe install -r app-release.apk`.
2. First launch: the app shows the start screen until the LifeOS server runs in Termux (see LifeOS-Desktop `phone/SETUP.md`).
3. Samsung Health: in Samsung Health > Settings > Health Connect, turn sync on; then open the app menu > Update health data and allow the permissions.

## Checks
`npx tsc --noEmit` and `npx expo-doctor` (both clean at v1.0).
