# Building the LifeOS APK

**Normal way: GitHub Actions.** `.github/workflows/android-apk.yml` builds the APK on a Linux runner every time `main` is pushed (or from the Actions tab > Android APK > Run workflow). Download it from the run's Artifacts or from the repo's Releases page (`LifeOS-v<VERSION>.apk`). This avoids the Windows problem described below, and is how ERICA is built too.

**Local Windows build (not recommended):** it fails in the C++ step (`ninja: error: mkdir(...)`) because the SDK's ninja 1.10.2 cannot use long paths (Windows `LongPathsEnabled` is already 1; moving the project to `C:\lm` did not help). It would need a newer `ninja.exe` in `%LOCALAPPDATA%\Android\Sdk\cmake\3.22.1\bin`. The notes below are for that route.

**Build from a short folder path (for example `C:\lm`).** From `C:\Users\Jesse\Documents\Code\LifeOS-Mobile` the C++ step fails with `ninja: error: Stat(...)` because Windows' 260-character path limit is exceeded inside `android\app\.cxx` and the libraries' generated folders (seen on 2026-11-15 with `react_codegen_safeareacontext`). Copy the project to a short path (without `node_modules`, `android`, `.tools`), run `npm install` there, then follow the steps below.

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
