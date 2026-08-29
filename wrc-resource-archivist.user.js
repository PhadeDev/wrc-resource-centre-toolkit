// ==UserScript==
// @name         Westminster RC - Resource Centre Archivist
// @namespace    https://westminster.cadetnet.mod.uk/
// @version      0.2
// @description  Build a Resource Centre archive manifest and download documents into folder structure.
// @match        https://westminster.cadetnet.mod.uk/app/r/westminster/resource_centre/manage-documents*
// @match        https://westminster.cadetnet.mod.uk/app/r/westminster/resource_centre/bulk-manage-documents*
// @match        https://www.westminster.cadetnet.mod.uk/app/r/westminster/resource_centre/manage-documents*
// @match        https://www.westminster.cadetnet.mod.uk/app/r/westminster/resource_centre/bulk-manage-documents*
// @grant        none
// @run-at       document-idle
// @updateURL    https://raw.githubusercontent.com/PhadeDev/wrc-resource-centre-toolkit/main/wrc-resource-archivist.user.js
// @downloadURL  https://raw.githubusercontent.com/PhadeDev/wrc-resource-centre-toolkit/main/wrc-resource-archivist.user.js
// ==/UserScript==

(function () {
  'use strict';

  const VERSION = '0.1';
  const LS_DOCS = 'wrc_archivist_docs';
  const LS_PLACEMENTS = 'wrc_archivist_placements';
  const LS_SCAN_META = 'wrc_archivist_scan_meta';
  const DELAY_BETWEEN_DOWNLOADS_MS = 1500;

  let docs = loadJson(LS_DOCS, {});
  let placements = loadJson(LS_PLACEMENTS, []);
  let scanMeta = loadJson(LS_SCAN_META, {});
  let archiveRoot = null;
  let running = false;
  let stopRequested = false;

  const style = document.createElement('style');
  style.textContent = `
    #wrc-arch-panel {
      position:fixed; right:24px; bottom:24px; width:420px; z-index:2147483646;
      background:#fff; border:2px solid #6f42c1; border-radius:8px;
      box-shadow:0 6px 24px rgba(0,0,0,.24);
      font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;
      color:#222; font-size:13px;
    }
    #wrc-arch-head {
      background:#6f42c1; color:#fff; padding:9px 12px; font-weight:700;
      border-radius:6px 6px 0 0; display:flex; justify-content:space-between;
      align-items:center; cursor:move; user-select:none;
    }
    #wrc-arch-head button {
      background:rgba(255,255,255,.2); color:#fff; border:1px solid rgba(255,255,255,.5);
      border-radius:4px; cursor:pointer; padding:1px 7px;
    }
    #wrc-arch-body { padding:12px; }
    #wrc-arch-body label { display:block; font-size:12px; font-weight:700; margin:8px 0 3px; }
    .wrc-arch-row { display:flex; gap:6px; flex-wrap:wrap; margin-top:8px; align-items:center; }
    .wrc-arch-btn {
      border:none; border-radius:4px; padding:6px 10px; color:#fff; cursor:pointer;
      font-size:12px; font-weight:700;
    }
    .wrc-arch-btn:disabled { opacity:.4; cursor:not-allowed; }
    .wrc-purple { background:#6f42c1; }
    .wrc-blue { background:#0572ce; }
    .wrc-green { background:#198754; }
    .wrc-grey { background:#6c757d; }
    .wrc-red { background:#dc3545; }
    #wrc-arch-folder-filter {
      width:100%; box-sizing:border-box; padding:7px 8px; border:1px solid #ccc;
      border-radius:4px; font-size:12px;
    }
    #wrc-arch-summary, #wrc-arch-status {
      font-size:11px; color:#555; line-height:1.45; margin-top:6px;
    }
    #wrc-arch-status.ok { color:#198754; font-weight:700; }
    #wrc-arch-status.err { color:#dc3545; font-weight:700; }
    #wrc-arch-log {
      margin-top:10px; max-height:120px; overflow:auto; border:1px solid #eee;
      border-radius:4px; padding:5px 7px; font-size:11px; line-height:1.45;
      background:#fafafa;
    }
    #wrc-arch-log .ok { color:#198754; }
    #wrc-arch-log .warn { color:#856404; }
    #wrc-arch-log .err { color:#dc3545; }
    #wrc-arch-log .info { color:#555; }
  `;
  document.head.appendChild(style);

  const panel = document.createElement('div');
  panel.id = 'wrc-arch-panel';
  panel.innerHTML = `
    <div id="wrc-arch-head">
      <span>Resource Centre Archivist v${VERSION}</span>
      <button id="wrc-arch-min" type="button">-</button>
    </div>
    <div id="wrc-arch-body">
      <div id="wrc-arch-summary"></div>

      <label>1. Scan This Report</label>
      <div class="wrc-arch-row">
        <button class="wrc-arch-btn wrc-purple" id="wrc-arch-scan-page" type="button">Scan Current Page</button>
        <button class="wrc-arch-btn wrc-blue" id="wrc-arch-scan-all" type="button">Scan All Pages</button>
      </div>

      <label>2. Archive Folder</label>
      <div class="wrc-arch-row">
        <button class="wrc-arch-btn wrc-grey" id="wrc-arch-pick-folder" type="button">Choose Archive Folder</button>
      </div>

      <label>3. Filter Folder Path</label>
      <input id="wrc-arch-folder-filter" list="wrc-arch-folder-list" placeholder="Type or choose a folder path">
      <datalist id="wrc-arch-folder-list"></datalist>
      <div class="wrc-arch-row">
        <label style="display:flex;gap:6px;align-items:center;margin:0;font-weight:600">
          <input id="wrc-arch-include-sub" type="checkbox" checked> Include subfolders
        </label>
      </div>

      <label>4. Export Or Download</label>
      <div class="wrc-arch-row">
        <button class="wrc-arch-btn wrc-grey" id="wrc-arch-export" type="button">Export Manifest</button>
        <button class="wrc-arch-btn wrc-green" id="wrc-arch-download" type="button">Download Filtered</button>
        <button class="wrc-arch-btn wrc-red" id="wrc-arch-stop" type="button" disabled>Stop</button>
      </div>
      <div id="wrc-arch-status"></div>
      <div id="wrc-arch-log"></div>
    </div>
  `;
  document.body.appendChild(panel);

  const $ = id => panel.querySelector('#' + id);
  const elBody = $('wrc-arch-body');
  const elSummary = $('wrc-arch-summary');
  const elStatus = $('wrc-arch-status');
  const elLog = $('wrc-arch-log');
  const elFolderFilter = $('wrc-arch-folder-filter');
  const elFolderList = $('wrc-arch-folder-list');
  const elIncludeSub = $('wrc-arch-include-sub');
  const btnScanPage = $('wrc-arch-scan-page');
  const btnScanAll = $('wrc-arch-scan-all');
  const btnPickFolder = $('wrc-arch-pick-folder');
  const btnExport = $('wrc-arch-export');
  const btnDownload = $('wrc-arch-download');
  const btnStop = $('wrc-arch-stop');

  let drag = false, ox = 0, oy = 0;
  $('wrc-arch-head').addEventListener('mousedown', e => {
    if (e.target.tagName === 'BUTTON') return;
    drag = true;
    ox = e.clientX - panel.offsetLeft;
    oy = e.clientY - panel.offsetTop;
  });
  document.addEventListener('mousemove', e => {
    if (!drag) return;
    panel.style.right = 'auto';
    panel.style.bottom = 'auto';
    panel.style.left = `${e.clientX - ox}px`;
    panel.style.top = `${e.clientY - oy}px`;
  });
  document.addEventListener('mouseup', () => { drag = false; });

  $('wrc-arch-min').addEventListener('click', () => {
    elBody.style.display = elBody.style.display === 'none' ? '' : 'none';
  });

  btnScanPage.addEventListener('click', () => scanCurrentPage());
  btnScanAll.addEventListener('click', () => scanAllPages());
  btnPickFolder.addEventListener('click', chooseArchiveFolder);
  btnExport.addEventListener('click', exportManifest);
  btnDownload.addEventListener('click', downloadFiltered);
  btnStop.addEventListener('click', () => {
    stopRequested = true;
    btnStop.disabled = true;
    setStatus('Stop requested. Current file will finish first.', 'err');
    log('Stop requested', 'warn');
  });

  updateSummary();

  function loadJson(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch (_) {
      return fallback;
    }
  }

  function saveState() {
    localStorage.setItem(LS_DOCS, JSON.stringify(docs));
    localStorage.setItem(LS_PLACEMENTS, JSON.stringify(placements));
    localStorage.setItem(LS_SCAN_META, JSON.stringify(scanMeta));
  }

  function log(msg, type = 'info') {
    const t = new Date().toLocaleTimeString('en-GB', { hour12: false });
    const div = document.createElement('div');
    div.className = type;
    div.textContent = `[${t}] ${msg}`;
    elLog.appendChild(div);
    elLog.scrollTop = elLog.scrollHeight;
  }

  function setStatus(msg, type = '') {
    elStatus.className = type;
    elStatus.textContent = msg;
  }

  function normalise(value) {
    return String(value || '').replace(/\s+/g, ' ').trim();
  }

  function cellText(cell) {
    return (cell?.innerText || cell?.textContent || '').replace(/\r/g, '').trim();
  }

  function splitLines(value) {
    return String(value || '')
      .split(/\n+/)
      .map(v => normalise(v))
      .filter(Boolean);
  }

  function absUrl(url) {
    try { return new URL(url, location.href).href; }
    catch (_) { return url || ''; }
  }

  function csvEscape(value) {
    const s = String(value ?? '');
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  }

  function makeCsv(rows) {
    if (!rows.length) return '';
    const headers = Object.keys(rows[0]);
    return [
      headers.map(csvEscape).join(','),
      ...rows.map(row => headers.map(h => csvEscape(row[h])).join(','))
    ].join('\n');
  }

  function reportTables() {
    return Array.from(document.querySelectorAll('table')).map(table => {
      const first = table.querySelector('tr');
      const headers = first ? Array.from(first.querySelectorAll('th,td')).map(cellText) : [];
      return { table, headers };
    });
  }

  function detectReportType() {
    for (const item of reportTables()) {
      const h = item.headers.join('|').toLowerCase();
      if (h.includes('file name') && h.includes('download')) return { type: 'manage', table: item.table, headers: item.headers };
      if (h.includes('folder path') && h.includes('key document yn')) return { type: 'bulk', table: item.table, headers: item.headers };
    }
    return { type: '', table: null, headers: [] };
  }

  function headerIndex(headers, name) {
    return headers.findIndex(h => h.toLowerCase() === name.toLowerCase());
  }

  function idFromHref(href) {
    const decoded = decodeURIComponent(String(href || ''));
    let m = decoded.match(/ai_download_file_id=(\d+)/i);
    if (m) return m[1];
    m = decoded.match(/p5_rc_file_metadata_id=(\d+)/i);
    return m ? m[1] : '';
  }

  function scrapeManageRows(table, headers) {
    const idx = {
      link: headerIndex(headers, 'Link'),
      displayName: headerIndex(headers, 'Display Name'),
      status: headerIndex(headers, 'Status'),
      fileName: headerIndex(headers, 'File Name'),
      folderEntries: headerIndex(headers, '# Folder Entries'),
      version: headerIndex(headers, 'Version'),
      description: headerIndex(headers, 'Description'),
      tags: headerIndex(headers, 'Tags'),
      keyDocument: headerIndex(headers, 'Key Document?'),
      fileType: headerIndex(headers, 'File Type'),
      download: headerIndex(headers, 'Download')
    };
    const found = [];
    for (const tr of Array.from(table.querySelectorAll('tr')).slice(1)) {
      const cells = Array.from(tr.querySelectorAll('td,th'));
      if (!cells.length) continue;
      const downloadLink = cells[idx.download]?.querySelector('a[href*="DOWNLOAD_FILE"],a[href*="ai_download_file_id"]');
      const editLink = cells[idx.link]?.querySelector('a[href*="manage-document"],a[href*="p5_rc_file_metadata_id"]');
      const id = idFromHref(downloadLink?.getAttribute('href')) || idFromHref(editLink?.getAttribute('href'));
      if (!id) continue;
      found.push({
        id,
        displayName: cellText(cells[idx.displayName]),
        status: cellText(cells[idx.status]),
        fileName: cellText(cells[idx.fileName]),
        folderEntries: cellText(cells[idx.folderEntries]),
        version: cellText(cells[idx.version]),
        description: cellText(cells[idx.description]),
        tags: cellText(cells[idx.tags]),
        keyDocument: /^yes$/i.test(cellText(cells[idx.keyDocument])),
        fileType: cellText(cells[idx.fileType]),
        downloadUrl: absUrl(downloadLink?.getAttribute('href') || ''),
        editUrl: absUrl(editLink?.getAttribute('href') || ''),
        scannedAt: new Date().toISOString()
      });
    }
    return found;
  }

  function scrapeBulkRows(table, headers) {
    const idx = {
      displayName: headerIndex(headers, 'Display Name'),
      folderPath: headerIndex(headers, 'Folder Path'),
      folder: headerIndex(headers, 'Folder'),
      description: headerIndex(headers, 'Description'),
      tags: headerIndex(headers, 'Tags'),
      version: headerIndex(headers, 'Version'),
      keyDocument: headerIndex(headers, 'Key Document YN'),
      startDate: headerIndex(headers, 'Published Start Date'),
      endDate: headerIndex(headers, 'Published End Date')
    };
    const found = [];
    for (const tr of Array.from(table.querySelectorAll('tr')).slice(1)) {
      const cells = Array.from(tr.querySelectorAll('td,th'));
      if (!cells.length) continue;
      const cb = cells[0]?.querySelector('input[type="checkbox"]');
      const id = cb?.value && cb.value !== 'all' ? cb.value : '';
      if (!id) continue;

      const folderPaths = splitLines(cellText(cells[idx.folderPath]));
      const folders = splitLines(cellText(cells[idx.folder]));
      const base = {
        id,
        displayName: cellText(cells[idx.displayName]),
        description: cellText(cells[idx.description]),
        tags: cellText(cells[idx.tags]),
        version: cellText(cells[idx.version]),
        keyDocument: /^y(es)?$/i.test(cellText(cells[idx.keyDocument])),
        startDate: cellText(cells[idx.startDate]),
        endDate: cellText(cells[idx.endDate]),
        scannedAt: new Date().toISOString()
      };
      const paths = folderPaths.length ? folderPaths : [''];
      paths.forEach((folderPath, i) => {
        found.push({
          ...base,
          folderPath,
          folder: folders[i] || folders[0] || lastFolderSegment(folderPath),
          placementKey: `${id}|${folderPath}`
        });
      });
    }
    return found;
  }

  function lastFolderSegment(path) {
    const parts = String(path || '').split('>').map(p => p.trim()).filter(Boolean);
    return parts[parts.length - 1] || '';
  }

  function scanCurrentPage() {
    const report = detectReportType();
    if (!report.table) {
      setStatus('No recognised Manage Documents or Bulk Manage Documents report found.', 'err');
      return;
    }

    if (report.type === 'manage') {
      const rows = scrapeManageRows(report.table, report.headers);
      for (const row of rows) docs[row.id] = { ...(docs[row.id] || {}), ...row };
      scanMeta.manageLastScan = new Date().toISOString();
      log(`Scanned ${rows.length} Manage Documents row(s)`, rows.length ? 'ok' : 'warn');
    } else {
      const rows = scrapeBulkRows(report.table, report.headers);
      const map = new Map(placements.map(p => [p.placementKey, p]));
      for (const row of rows) map.set(row.placementKey, { ...(map.get(row.placementKey) || {}), ...row });
      placements = Array.from(map.values());
      scanMeta.bulkLastScan = new Date().toISOString();
      log(`Scanned ${rows.length} Bulk Manage placement row(s)`, rows.length ? 'ok' : 'warn');
    }

    saveState();
    updateSummary();
  }

  async function scanAllPages() {
    if (running) return;
    running = true;
    stopRequested = false;
    btnStop.disabled = false;
    setButtonsDisabled(true);

    const report = detectReportType();
    if (!report.table) {
      setStatus('No recognised report found.', 'err');
      finishRun();
      return;
    }

    let pages = 0;
    const seenSignatures = new Set();
    try {
      while (!stopRequested) {
        const sig = currentPageSignature();
        if (seenSignatures.has(sig)) break;
        seenSignatures.add(sig);
        scanCurrentPage();
        pages++;
        setStatus(`Scanned ${pages} page(s). Looking for next page...`);
        const next = findNextButton();
        if (!next) break;
        next.click();
        await waitForPageChange(sig);
      }
      setStatus(`Scan all complete: ${pages} page(s).`, 'ok');
    } catch (e) {
      log(`Scan all failed: ${e.message}`, 'err');
      setStatus(`Scan all failed: ${e.message}`, 'err');
    }
    finishRun();
  }

  function currentPageSignature() {
    const report = detectReportType();
    if (!report.table) return '';
    return Array.from(report.table.querySelectorAll('tr')).slice(1, 6)
      .map(tr => normalise(tr.textContent).slice(0, 120))
      .join('|');
  }

  function findNextButton() {
    const buttons = Array.from(document.querySelectorAll('button[title="Next"],button[aria-label="Next"],a[title="Next"],a[aria-label="Next"]'));
    return buttons.find(btn => {
      const cls = btn.className || '';
      const disabled = btn.disabled || btn.getAttribute('aria-disabled') === 'true' || /\bis-disabled\b|\bdisabled\b/.test(String(cls));
      return !disabled && btn.offsetParent !== null;
    }) || null;
  }

  async function waitForPageChange(previousSig) {
    const deadline = Date.now() + 15000;
    while (Date.now() < deadline) {
      await sleep(500);
      if (currentPageSignature() && currentPageSignature() !== previousSig) return;
    }
    throw new Error('Report did not move to next page in time');
  }

  function finishRun() {
    running = false;
    stopRequested = false;
    btnStop.disabled = true;
    setButtonsDisabled(false);
  }

  function setButtonsDisabled(disabled) {
    btnScanPage.disabled = disabled;
    btnScanAll.disabled = disabled;
    btnPickFolder.disabled = disabled;
    btnExport.disabled = disabled;
    btnDownload.disabled = disabled;
  }

  function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  function joinedRows() {
    const rows = [];
    for (const placement of placements) {
      const doc = docs[placement.id] || {};
      rows.push({
        id: placement.id,
        displayName: doc.displayName || placement.displayName || '',
        fileName: doc.fileName || '',
        folderPath: placement.folderPath || '',
        folder: placement.folder || '',
        status: doc.status || '',
        version: doc.version || placement.version || '',
        description: doc.description || placement.description || '',
        tags: doc.tags || placement.tags || '',
        keyDocument: doc.keyDocument ?? placement.keyDocument ?? false,
        startDate: placement.startDate || '',
        endDate: placement.endDate || '',
        fileType: doc.fileType || '',
        downloadUrl: doc.downloadUrl || ''
      });
    }
    return rows.sort((a, b) =>
      a.folderPath.localeCompare(b.folderPath, undefined, { sensitivity: 'base' }) ||
      a.displayName.localeCompare(b.displayName, undefined, { sensitivity: 'base' })
    );
  }

  function filteredRows() {
    const filter = normalise(elFolderFilter.value);
    const includeSub = elIncludeSub.checked;
    return joinedRows().filter(row => {
      if (!filter) return true;
      const path = row.folderPath || '';
      return includeSub ? path === filter || path.startsWith(filter + ' >') : path === filter;
    });
  }

  function updateSummary() {
    const docCount = Object.keys(docs).length;
    const placementCount = placements.length;
    const joined = joinedRows();
    const withLinks = joined.filter(r => r.downloadUrl).length;
    const folders = Array.from(new Set(placements.map(p => p.folderPath).filter(Boolean)))
      .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
    elFolderList.innerHTML = '';
    for (const folder of folders) {
      const opt = document.createElement('option');
      opt.value = folder;
      elFolderList.appendChild(opt);
    }
    elSummary.innerHTML = `
      <strong>${docCount}</strong> document(s) indexed,
      <strong>${placementCount}</strong> folder placement(s),
      <strong>${withLinks}</strong> placement(s) with download links.
    `;
  }

  function exportManifest() {
    const rows = joinedRows();
    if (!rows.length) {
      setStatus('Nothing to export yet. Scan both reports first.', 'err');
      return;
    }
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    downloadText(`wrc-archive-manifest-${stamp}.json`, JSON.stringify(rows, null, 2), 'application/json');
    downloadText(`wrc-archive-manifest-${stamp}.csv`, makeCsv(rows), 'text/csv');
    log(`Manifest exported: ${rows.length} placement row(s)`, 'ok');
  }

  function downloadText(filename, text, type) {
    const blob = new Blob([text], { type });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  async function chooseArchiveFolder() {
    if (!window.showDirectoryPicker) {
      setStatus('This browser does not expose folder writing. Use Chrome or Edge.', 'err');
      return;
    }
    try {
      archiveRoot = await window.showDirectoryPicker({ mode: 'readwrite' });
      setStatus(`Archive folder selected: ${archiveRoot.name}`, 'ok');
      log(`Archive folder selected: ${archiveRoot.name}`, 'ok');
    } catch (e) {
      if (e.name !== 'AbortError') log(`Folder pick failed: ${e.message}`, 'err');
    }
  }

  async function downloadFiltered() {
    if (running) return;
    if (!archiveRoot) {
      setStatus('Choose an archive folder first.', 'err');
      return;
    }
    const rows = filteredRows();
    if (!rows.length) {
      setStatus('No manifest rows match that filter.', 'err');
      return;
    }
    const unique = new Map();
    for (const row of rows) {
      if (!row.downloadUrl) continue;
      if (!unique.has(row.id)) unique.set(row.id, { doc: row, placements: [] });
      unique.get(row.id).placements.push(row);
    }
    if (!unique.size) {
      setStatus('Filtered rows have no download links. Scan Manage Documents first.', 'err');
      return;
    }

    running = true;
    stopRequested = false;
    btnStop.disabled = false;
    setButtonsDisabled(true);

    let done = 0, failed = 0;
    const writtenNames = new Set();
    const results = [];
    const entries = Array.from(unique.values());
    try {
      await writeManifestFiles(rows);
      for (let i = 0; i < entries.length; i++) {
        if (stopRequested) break;
        const { doc, placements: docPlacements } = entries[i];
        setStatus(`Downloading ${i + 1}/${entries.length}: ${doc.displayName || doc.fileName}`);
        try {
          const blob = await fetchBlob(doc.downloadUrl);
          for (const placement of docPlacements) {
            const filename = uniqueArchiveFilename(writtenNames, doc, placement);
            const dir = await ensureDir(archiveRoot, placement.folderPath || '_No Folder');
            await writeBlob(dir, filename, blob);
            results.push({ id: doc.id, fileName: filename, folderPath: placement.folderPath, status: 'ok', error: '' });
          }
          done++;
          log(`Downloaded ${i + 1}/${entries.length}: ${doc.displayName || doc.fileName}`, 'ok');
        } catch (e) {
          failed++;
          results.push({ id: doc.id, fileName: doc.fileName, folderPath: '', status: 'failed', error: e.message });
          log(`Download failed for ${doc.displayName || doc.fileName}: ${e.message}`, 'err');
        }
        if (i < entries.length - 1 && !stopRequested) await sleep(DELAY_BETWEEN_DOWNLOADS_MS);
      }
      await writeLogCsv(results);
      setStatus(`Download run complete: ${done}/${entries.length} downloaded, ${failed} failed.`, failed ? 'err' : 'ok');
    } finally {
      finishRun();
    }
  }

  async function fetchBlob(url) {
    const res = await fetch(url, { credentials: 'include' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.blob();
  }

  function archiveFilename(doc, placement) {
    const base = doc.fileName || `${doc.displayName || doc.id}.bin`;
    return safeSegment(base);
  }

  function uniqueArchiveFilename(writtenNames, doc, placement) {
    const folderPath = placement.folderPath || '_No Folder';
    const base = archiveFilename(doc, placement);
    const key = name => `${folderPath}>${name}`.toLowerCase();
    if (!writtenNames.has(key(base))) {
      writtenNames.add(key(base));
      return base;
    }

    const dot = base.lastIndexOf('.');
    const stem = dot > 0 ? base.slice(0, dot) : base;
    const ext = dot > 0 ? base.slice(dot) : '';
    for (let i = 2; i < 1000; i++) {
      const candidate = `${stem} (${doc.id}-${i})${ext}`;
      if (!writtenNames.has(key(candidate))) {
        writtenNames.add(key(candidate));
        return candidate;
      }
    }
    const fallback = `${stem} (${doc.id}-${Date.now()})${ext}`;
    writtenNames.add(key(fallback));
    return fallback;
  }

  function safeSegment(segment) {
    return String(segment || '')
      .replace(/[\\/:*?"<>|]/g, '-')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 180) || '_';
  }

  async function ensureDir(root, folderPath) {
    let dir = root;
    const parts = String(folderPath || '_No Folder')
      .split('>')
      .map(safeSegment)
      .filter(Boolean);
    for (const part of parts) {
      dir = await dir.getDirectoryHandle(part, { create: true });
    }
    return dir;
  }

  async function writeBlob(dir, filename, blob) {
    const handle = await dir.getFileHandle(filename, { create: true });
    const writable = await handle.createWritable();
    await writable.write(blob);
    await writable.close();
  }

  async function writeTextFile(dir, filename, text, type = 'text/plain') {
    await writeBlob(dir, filename, new Blob([text], { type }));
  }

  async function writeManifestFiles(rows) {
    const meta = await archiveRoot.getDirectoryHandle('_metadata', { create: true });
    await writeTextFile(meta, 'archive-manifest.json', JSON.stringify(rows, null, 2), 'application/json');
    await writeTextFile(meta, 'archive-manifest.csv', makeCsv(rows), 'text/csv');
  }

  async function writeLogCsv(rows) {
    const meta = await archiveRoot.getDirectoryHandle('_metadata', { create: true });
    await writeTextFile(meta, 'download-log.csv', makeCsv(rows), 'text/csv');
  }
})();
