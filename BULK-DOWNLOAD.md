# Toolkit bulk downloads (v4.25)

The existing Toolkit now also runs on Manage Documents. On that page it shows only bulk download controls. The upload/home view remains available on the Resource Centre home page. The separate Archivist is not required for this workflow.

1. Update the Toolkit in Violentmonkey or Tampermonkey, then reload Manage Documents.
2. Apply the site's filters. Set the report rows per page to include the batch you want. Keep File Name, Download and # Folder Entries columns visible. Rows with zero Folder Entries are skipped and listed in the results, based on the user's observed broken downloads for these records.
3. Click **Choose download folder** and select the exact local batch folder in Chrome or Edge. Approve the browser's folder-write prompt. The last folder handle is saved in this site's IndexedDB and restored on refresh; clicking Download may require renewed write permission. Choose download folder changes the remembered folder. Clearing site data removes this memory. It is separate from the uploader's remembered source folder.
4. Set the pause between files if required (default 3 seconds).
5. Click **Download displayed files**. Keep the page open until it finishes. The results show saved files and failures. **Stop** cancels an active fetch or stops between files; an in-progress disk write finishes.

Only the displayed report rows are included, not other pages or a previously saved scan. Each document ID is fetched once per batch, sequentially. A pause reduces load but does not guarantee the site's monitoring will permit any particular volume. Explicit sign-in redirects and HTTP 401/403/429/503 stop the run. Other failed files, including unexpected HTML responses, are logged and the batch continues; HTML is not saved as a PDF/document. Requests time out after two minutes. A HTML response alone cannot distinguish a broken file from a login page returned without a sign-in redirect.

Raw files are saved with original filenames. There are no metadata exports. A filename clash is saved under `WRC-<source document ID>/<original filename>` inside your chosen folder; an existing file there is reported as failed rather than overwritten. This also applies to files already present from an earlier batch. No content comparison or automatic resume is performed.

The migration master CSV already includes source record IDs and filenames. Its 40 duplicate-filename groups cannot be joined reliably by filename alone. Keep the ID subfolders until those records are reconciled for vault import. Ordinary unique filenames can be matched to the existing CSV directly. Windows-invalid filenames stop the batch before downloading rather than silently renaming them.

Source checks use a simulated report and folder API. Live APEX report parsing, authenticated file responses, and the browser's actual folder-write permission still require a small live batch check by the user. If the panel reports no recognized report, check that the two required columns are visible before diagnosing markup changes.

Run the offline checks with `node download-check.cjs`.

Live download protocol confirmed by user Network evidence: the report href alone returns Manage Documents HTML. The working click calls APEX application process DOWNLOAD_DOCUMENT with x01 set to the document ID; JSON returns a temporary Oracle government object-storage URL. v4.25 uses apex.server.process for that authenticated request, then fetches the returned HTTPS URL with credentials omitted and writes the blob to the chosen folder. Temporary URLs are not persisted or logged. The cross-origin storage fetch still requires the storage server to permit browser access; a network/CORS failure stops the batch with an explicit message. Live user verification is pending.
