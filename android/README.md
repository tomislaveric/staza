# Staza Android

Native Android client (Kotlin, Jetpack Compose, Material 3).

- **Application ID:** `world.staza.app` (matches the iOS bundle identifier)
- **Min SDK:** 29 (Android 10) · **Target/compile SDK:** 36
- **Requirements:** JDK 17+ (Android Studio's bundled JBR works) and the Android SDK.

## Build and run

```sh
cd android
echo "sdk.dir=$HOME/Library/Android/sdk" > local.properties   # once
./gradlew assembleDebug        # build
./gradlew installDebug         # install on a running emulator/device
./gradlew testDebugUnitTest    # unit tests
```

Or open `android/` in Android Studio and run the `app` configuration.

## API base URL

- Debug builds use `http://10.0.2.2:3000` (the host machine from the emulator);
  override with `-PstazaApiBaseUrl=http://<host>:3000` or in `gradle.properties`.
- Release builds use `https://play.staza.world`.

## Structure

- `core/network` – Retrofit/OkHttp `ApiClient`: bearer injection, typed `ApiError`
  from the `{ "error" }` envelope, and refresh + single retry on 401.
- `core/auth` – `SessionManager` (observable `AuthState`), Tink/Keystore encrypted
  DataStore `CredentialStore`.
- `core/format` – locale-aware number, date, and distance formatting.
- `designsystem` – Material 3 theme (dynamic color, light/dark, spacing tokens).
- `shell` – `NavigationBar` + Add Activity FAB; destinations are placeholders.
- Strings live in `res/values` (English) and `res/values-de` (German).
