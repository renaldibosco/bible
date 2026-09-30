# Holy Bible

An Android Bible app with three languages you can switch between, and read-aloud.

- **English** — King James Version (public domain)
- **தமிழ்** — Indian Revised Version (IRV) Tamil, © Bridge Connectivity Solutions, CC BY-SA 4.0
- **ଓଡ଼ିଆ** — Indian Revised Version (IRV) Odia, © Bridge Connectivity Solutions, CC BY-SA 4.0

## Features
- Change language any time (the language button at the top); optionally show a second language under each verse
- Tap verses to select them → **Listen**, Copy or Share
- Long-press to select any text → **Read aloud**
- Speaker button reads the whole chapter, highlights each verse, and can continue into the next chapter
- Speed control, text size, Paper / Sepia / Night themes, search, works offline

## Download
https://github.com/renaldibosco/bible/releases/latest/download/HolyBible.apk

Read-aloud uses the phone's voices (Speech Services by Google). If a language says
"Not installed" in Settings, open *Settings › Voice* in the app and download that language.

## How it's built
Every push to `main` runs `.github/workflows/build-apk.yml`: it downloads the Tamil and Odia
USFM text from eBible.org, converts it with `tools/build_data.py`, builds the APK and publishes it
as a release. The KJV text is already in `app/src/main/assets/data/en`.
