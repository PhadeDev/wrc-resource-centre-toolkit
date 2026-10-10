# Toolkit bulk downloads (v4.28)

Two entry points share the same protocol: the Manage Documents batch panel (below) and, from v4.28, a **Download** tab on the Resource Centre home page for quick downloads from the document cards you can see. See "Quick download from home cards" at the end.

The existing Toolkit now also runs on Manage Documents. On that page it shows only bulk download controls. The upload/home view remains available on the Resource Centre home page. The separate Archivist is not required for this workflow.

1. Update the Toolkit in Violentmonkey or Tampermonkey, then reload Manage Documents.
2. Apply the site's filters. Set the report rows per page to include the batch you want. Keep File Name, Download and # Folder Entries columns visible. Rows with zero Folder Entries are skipped and listed in the results, based on the user's observed broken downloads for these records.
3. Click **Choose download folder** and select the exact local batch folder in Chrome or Edge. Approve the browser's folder-write prompt. The last folder handle is saved in this site's IndexedDB and restored on refresh; clicking Download may require renewed write permission. Choose download folder changes the remembered folder. Clearing site data removes this memory. It is separate from the uploader's remembered source folder.
4. Set the pause between files if required (default 3 seconds).
5. Click **Download displayed files**. Keep the page open until it finishes. The results show saved files and failures. **Stop** cancels an active fetch or stops between files; an in-progress disk write finishes.

Only the displayed report rows are included, not other pages or a previously saved scan. Each document ID is fetched once per batch, sequentially. A pause reduces load but does not guarantee the site's monitoring will permit any particular volume. Explicit sign-in redirects and HTTP 401/403/429/503 stop the run. Other failed files, including unexpected HTML responses, are logged and the batch continues; HTML is not saved as a PDF/document. Requests time out after two minutes. A HTML response alone cannot distinguish a broken file from a login page returned without a sign-in redirect.

Raw files are saved with original names in the chosen folder only. The first eligible report record for each filename is kept; later records with the same filename (case-insensitive) are skipped before requesting any URL. Files already in the destination folder are also skipped before downloading. No suffixes or subfolders are created. No content comparison is performed; same filename does not establish identical contents. If the first record fails, later duplicate records are still skipped.

The migration master CSV already includes source record IDs and filenames. Its 40 duplicate-filename groups cannot be joined reliably by filename alone. Duplicate source records must be reconciled separately in the CSV if needed; only one file per filename is downloaded. Ordinary unique filenames can be matched to the existing CSV directly. Windows-invalid filenames stop the batch before downloading rather than silently renaming them.

Source checks use a simulated report and folder API. Live APEX report parsing, authenticated file responses, and the browser's actual folder-write permission still require a small live batch check by the user. If the panel reports no recognized report, check that the two required columns are visible before diagnosing markup changes.

Run the offline checks with `node download-check.cjs`.

Live download protocol confirmed by user Network evidence: the report href alone returns Manage Documents HTML. The working click calls APEX application process DOWNLOAD_DOCUMENT with x01 set to the document ID; JSON returns a temporary Oracle government object-storage URL. v4.25 uses apex.server.process for that authenticated request, then fetches the returned HTTPS URL with credentials omitted and writes the blob to the chosen folder. Temporary URLs are not persisted or logged. The cross-origin storage fetch still requires the storage server to permit browser access; a network/CORS failure stops the batch with an explicit message. User confirmed the v4.25 download protocol works live; v4.27 duplicate skipping still needs user verification.

## Quick download from home cards (v4.28)

On the Resource Centre home page the toolkit panel has a **Download** tab. Choose a folder (Chrome or Edge), click **Choose Documents**, untick anything you do not want, then **Download Selected**. Only cards currently shown on the page are offered; External Link cards have no file and never appear. The quick-download folder is remembered separately from the Manage Documents folder, so a quick save cannot change where a batch goes.

The card links carry only a document ID (a plain fetch of them returns a web page), so the tab uses the same APEX DOWNLOAD_DOCUMENT process as Manage Documents. Cards show a Display Name, not the original file name, so the original name is read from the storage response Content-Disposition header (live-confirmed 10/10/2026), falling back to the storage object name with its leading document-ID prefix removed. Because that name is only known after the response headers arrive, duplicate-name and existing-file skips happen then, before the file body is read. The first card for a name is kept; later same-name cards are skipped. Nothing is overwritten and no subfolders or suffixes are created. The stop rules, pause, timeout and HTML guard match Manage Documents.

Run the offline checks with `node download-cards-check.cjs`. Live use on the home page (process call from cards, folder picker, real downloads) still needs a small live check by the user.
