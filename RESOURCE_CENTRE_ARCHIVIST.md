# Resource Centre Archivist

Source userscript:

`/home/Phaderon/Projects/userscripts/wrc-resource-archivist.user.js`

Current version: `0.1`

## Purpose

The Archivist is a separate userscript from the Resource Center Toolkit. It is intended for future safe export of Westminster Resource Centre documents, including metadata and folder placements.

It should be used while logged into Westminster in Chrome or Edge.

## Why Separate From The Toolkit

The existing Toolkit is for day-to-day work:

- upload queues
- folder scans
- secure link collection
- bulk edit folder assignment

The Archivist is different:

- long-running scans
- large manifest building
- local filesystem writes
- download retry/stop/resume work
- folder filtering
- archive metadata exports

Keeping it separate keeps both tools simpler.

## Pages Used

The Archivist runs on:

- `/resource_centre/manage-documents`
- `/resource_centre/bulk-manage-documents`

`Manage Documents` provides:

- document ID
- display name
- original file name
- status
- version
- description
- tags
- key document flag
- file type
- fresh download URL

`Bulk Manage Documents` provides:

- document ID from row checkbox value
- display name
- folder path
- folder name
- description/tags/version/key/start/end metadata

The join key is document ID. Do not rely on display name because duplicates are possible.

## Multi-Folder Documents

Some documents have more than one folder placement.

The archive model is:

- download each unique document once per run
- write/copy it into every folder path where it appears
- keep a manifest row for every document-folder placement

This preserves the Resource Centre structure even if it duplicates files on disk.

## Current v0.1 Features

- Floating panel: `Resource Centre Archivist`.
- `Scan Current Page` reads the currently visible report rows.
- `Scan All Pages` attempts to use the APEX report `Next` buttons until all pages are scanned.
- Stores scanned data in browser `localStorage`:
  - `wrc_archivist_docs`
  - `wrc_archivist_placements`
  - `wrc_archivist_scan_meta`
- Joins document metadata and folder placement data by document ID.
- Folder filter with `Include subfolders`.
- `Export Manifest` exports:
  - JSON
  - CSV
- `Choose Archive Folder` uses the Chrome/Edge File System Access API.
- `Download Filtered` downloads unique documents and writes them under the matching folder paths.
- Writes `_metadata/archive-manifest.json`, `_metadata/archive-manifest.csv`, and `_metadata/download-log.csv`.
- Stop button stops after the current file finishes.

## First Test Plan

1. Install `wrc-resource-archivist.user.js`.
2. Open `Manage Documents`.
3. Click `Scan Current Page`.
4. Open `Bulk Manage Documents`.
5. Click `Scan Current Page`.
6. Click `Export Manifest`.
7. Inspect the manifest for correct joins and folder paths.
8. Choose a very small folder in the filter.
9. Choose an archive folder.
10. Click `Download Filtered`.

Do not start with all 3,000+ documents. Prove 3-5 files first.

## Known Limits In v0.1

- Pagination scanning is best-effort and may need adjustment after live testing.
- Download URLs include session/checksum data and should be scanned fresh before a large download run.
- Duplicate file names in the same run get an ID-based suffix to avoid overwrites.
- Resume/retry is basic. Failed files are recorded in `download-log.csv`, but there is not yet a dedicated resume queue.
- The script assumes Chrome/Edge for local folder writes.

## Validation Command

```bash
node --check /home/Phaderon/Projects/userscripts/wrc-resource-archivist.user.js
```
