# ELF

A simple Christmas gift tracker for your phone: who you're buying for, gift ideas with photos, and what's bought, wrapped and given.

It works offline and keeps everything on your phone. Nothing is sent anywhere, and there's no account.

## How it works
- **People:** add the people on your list. Each row shows a thin bar with their gifts by stage, and how many are given (for example 2/3).
- **Gift ideas:** tap a person, then "Add gift idea". Write the idea, an optional note (shop, price, size), and add up to 3 photos. The phone offers the camera or the gallery.
- **Stages:** each gift has four steps: idea, bought, wrapped, given. Tap any step to set it, and tap an earlier one to undo.
- **Ideas for anyone:** ideas not meant for anyone yet go in the row at the top. Tap "Give to…" to move one to a person, with its photos and stage.
- **Edit or delete:** tap a gift to change it, move it to someone else, or delete it. Use "Edit" on a person's page to rename or delete them.
- **Language:** English or Italian, in the menu.

## Install on your phone
1. Open the app's address in Chrome on Android (or Safari on iPhone).
2. Android: ⋮ menu → **Install app**. iPhone: Share → **Add to Home Screen**.

## Backup
Everything, photos included, lives only in this phone's browser storage. Use **Menu → Export backup** to save a ZIP file (your list plus the photos), and **Import backup** to restore it, for example on a new phone. Importing replaces what's in the app.

## Files
| File | What it does |
|---|---|
| `index.html` | The page |
| `styles.css` | The look: cream paper, deep red, pine green and gold; always light |
| `lang.js` | All the text, in English and Italian |
| `app.js` | People, gifts, photos, stages, backup |
| `zip.js` | Makes and reads the backup ZIP, with no libraries |
| `sw.js` | Lets the app work offline. Bump `VERSION` whenever a file changes |
| `manifest.webmanifest`, `icons/` | Name and icon for the home screen |

made by gionzana · [☕ buy me a coffee](https://buymeacoffee.com/gionzana)

find more apps by me on [github](https://github.com/rb-gith?tab=repositories)
