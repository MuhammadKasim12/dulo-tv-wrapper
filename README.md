# Dulo TV

> ⚠️ **Disclaimer — Educational purposes only**
> This repository is a personal, educational example of building an Android TV
> WebView wrapper app. It is provided "as is", with no warranty of any kind,
> for learning/demonstration purposes only. Debug APKs published under
> [Releases](../../releases) are debug-signed builds intended for personal
> testing and sideloading, not production/Play Store distribution.

Android TV WebView wrapper app for **https://dulo.mov**.

[![Android CI](https://github.com/MuhammadKasim12/dulo-tv-wrapper/actions/workflows/android-ci.yml/badge.svg)](https://github.com/MuhammadKasim12/dulo-tv-wrapper/actions/workflows/android-ci.yml)

- Application name: `Dulo TV`
- Package: `com.dulo.tv`
- Min SDK: 21, Target/Compile SDK: 34
- Gradle 8.4, AGP 8.2.2, Kotlin 1.9.22, JDK 17

## Opening the project

1. Open this folder in **Android Studio (Giraffe/Iguana or newer)**.
2. Android Studio will detect `gradle/wrapper/gradle-wrapper.properties` and
   offer to download the matching Gradle distribution automatically. Accept it.
   - Alternatively, if you have Gradle installed locally, run:
     `gradle wrapper --gradle-version 8.4` from this directory to generate
     `gradlew` / `gradlew.bat` yourself.
3. Let Gradle sync, then Run on an Android TV emulator or device.

## Placeholder art

`app/src/main/res/drawable/banner.xml` (320x180 TV launcher banner) and
`app/src/main/res/drawable/ic_launcher.xml` (app icon) are simple vector
placeholders so the project compiles and runs immediately. Replace them with
real branded artwork before publishing.

## CI / Releases

- `.github/workflows/android-ci.yml` builds a debug APK on every push/PR to
  `main` and uploads it as a workflow artifact (Actions tab).
- `.github/workflows/release.yml` builds a debug APK and attaches it to a
  GitHub Release whenever a tag matching `v*.*.*` is pushed
  (e.g. `git tag v1.0.0 && git push origin v1.0.0`).
- Both workflows build with `gradle` directly (Gradle is provisioned by
  `gradle/actions/setup-gradle`), so no `gradlew` binary needs to be committed.

## Notes

- WebView loads `https://dulo.mov` with JavaScript, DOM storage, database
  storage, and autoplay media enabled.
- The Android TV remote **Back** button navigates WebView history before
  exiting the app.
- Fullscreen `<video>` playback (e.g. HTML5 players) is supported via
  `WebChromeClient#onShowCustomView`.
