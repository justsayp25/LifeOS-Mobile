# Requests for LifeOS-Desktop (from the app)

Open items the app would like the Desktop package to handle. None blocks the first APK.

1. **Dictation in the WebView.** The mic button and the press-and-hold on the centre circle use the browser's `SpeechRecognition`, which the Android WebView does not have. When it is missing, `startVoice` in `Main.dc.html` / `Phone.dc.html` should use `window.reneeVoice.listen` (the same Whisper engine as conversation mode) and put the text in the field.
2. **Android back button.** The app calls the WebView's history back. The design wants "close the agent sheet first, then go up a page". The pages could listen for a `lifeos-back` event (the app can dispatch it with `injectJavaScript`) and close the sheet or panel when one is open.
3. **A Sync entry in the pages (optional).** The app has Sync in its own menu (`POST /api/gitsync/run`). If you want a button inside the pages as well, add it in the Areas or Home header (no design yet).
