// ==UserScript==
// @name         Westminster RC – Resource Center Toolkit
// @namespace    https://westminster.cadetnet.mod.uk/
// @version      4.17
// @description  Resource Centre upload, folder, link, and bulk edit tools.
// @match        https://westminster.cadetnet.mod.uk/app/r/westminster/resource_centre/home*
// @match        https://www.westminster.cadetnet.mod.uk/app/r/westminster/resource_centre/home*
// @grant        none
// @run-at       document-idle
// @updateURL    https://raw.githubusercontent.com/PhadeDev/wrc-resource-centre-toolkit/main/wrc-bulk-uploader.user.js
// @downloadURL  https://raw.githubusercontent.com/PhadeDev/wrc-resource-centre-toolkit/main/wrc-bulk-uploader.user.js
// ==/UserScript==

(function () {
  'use strict';

  // ── Pacing config ──────────────────────────────────────────────────────────
  const SCRIPT_VERSION  = '4.17';
  const MIN_DELAY_S      = 5;
  const MAX_DELAY_S      = 12;
  const IFRAME_TIMEOUT_MS = 10000;
  const SUBMIT_TIMEOUT_MS = 60000;

  const LS_QUEUE = 'wrc_bulk_queue';
  const LS_INDEX = 'wrc_bulk_index';
  const LS_FOLDERS = 'wrc_bulk_folders';
  const LS_FOLDERS_SAVED_AT = 'wrc_bulk_folders_saved_at';
  const IDB_NAME = 'wrc_bulk_uploader';
  const IDB_STORE = 'handles';
  const IDB_FOLDER_KEY = 'document_folder';

  // ── State ──────────────────────────────────────────────────────────────────
  let queue = [];
  let currentIndex = 0;
  let running = false;
  let paused  = false;
  let dirHandle = null;
  let lastScannedFolders = null;  // stored after a scan so the copy button can use it

  // Intercept window.open so we can access LOV popup windows from the same origin
  let _openedPopups = [];
  const _origWindowOpen = window.open.bind(window);
  window.open = function (...args) {
    const w = _origWindowOpen(...args);
    if (w) _openedPopups.push(w);
    return w;
  };

  // ── Restore persisted queue ────────────────────────────────────────────────
  try {
    const q = localStorage.getItem(LS_QUEUE);
    if (q) queue = JSON.parse(q);
    const idx = localStorage.getItem(LS_INDEX);
    if (idx !== null) currentIndex = parseInt(idx, 10);
    const folders = localStorage.getItem(LS_FOLDERS);
    if (folders) lastScannedFolders = normaliseFolderList(JSON.parse(folders));
  } catch (_) {}

  // ── Styles ─────────────────────────────────────────────────────────────────
  const style = document.createElement('style');
  style.textContent = `
    #wrc-panel {
      position:fixed; bottom:24px; right:24px; width:380px;
      background:#fff; border:2px solid #0572ce; border-radius:8px;
      box-shadow:0 6px 24px rgba(0,0,0,.22); z-index:2147483646;
      font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;
      font-size:13px; color:#222;
    }
    #wrc-header {
      background:#0572ce; color:#fff; padding:9px 12px;
      border-radius:6px 6px 0 0; display:flex;
      justify-content:space-between; align-items:center;
      cursor:move; user-select:none; font-weight:600; font-size:14px;
    }
    #wrc-header-btns { display:flex; gap:6px; }
    #wrc-header-btns button {
      background:rgba(255,255,255,.2); border:1px solid rgba(255,255,255,.4);
      color:#fff; cursor:pointer; padding:1px 7px; border-radius:3px; font-size:12px;
    }
    #wrc-body { padding:12px; }
    #wrc-body textarea {
      width:100%; box-sizing:border-box; font-size:11px; font-family:monospace;
      border:1px solid #ccc; border-radius:4px; padding:6px; resize:vertical;
    }
    #wrc-body label { display:block; font-weight:600; margin:8px 0 3px; font-size:12px; }
    #wrc-tabs {
      display:grid; grid-template-columns:repeat(4, 1fr); gap:4px;
      padding:8px; border-bottom:1px solid #d8d8d8; background:#f6f8fa;
    }
    .wrc-tab {
      border:1px solid #d0d7de; background:#fff; color:#333; border-radius:4px;
      padding:5px 4px; font-size:12px; font-weight:650; cursor:pointer;
    }
    .wrc-tab.active { background:#0572ce; border-color:#0572ce; color:#fff; }
    .wrc-pane { display:none; }
    .wrc-pane.active { display:block; }
    .wrc-row { display:flex; gap:6px; margin-top:8px; flex-wrap:wrap; }
    .wrc-btn {
      padding:5px 12px; border:none; border-radius:4px; cursor:pointer;
      font-size:12px; font-weight:600; transition:opacity .15s;
    }
    .wrc-btn:disabled { opacity:.35; cursor:not-allowed; }
    .wrc-btn-primary { background:#0572ce; color:#fff; }
    .wrc-btn-success { background:#198754; color:#fff; }
    .wrc-btn-warn    { background:#fd7e14; color:#fff; }
    .wrc-btn-danger  { background:#dc3545; color:#fff; }
    .wrc-btn-grey    { background:#6c757d; color:#fff; }
    .wrc-btn-teal    { background:#0d9488; color:#fff; }
    #wrc-folder-status  { font-size:11px; margin-top:4px; color:#666; }
    #wrc-folder-status.ok { color:#198754; font-weight:600; }
    #wrc-scan-status    { font-size:11px; margin-top:4px; color:#666; }
    #wrc-scan-status.ok { color:#198754; font-weight:600; }
    #wrc-queue-status   { font-size:11px; margin-top:4px; color:#666; }
    #wrc-queue-status.ok  { color:#198754; }
    #wrc-queue-status.err { color:#dc3545; }
    #wrc-progress-label {
      font-size:12px; font-weight:600; margin:10px 0 4px; color:#0572ce;
    }
    #wrc-item-list { max-height:120px; overflow-y:auto; }
    .wrc-item {
      padding:4px 8px; border-radius:4px; font-size:11px;
      margin:2px 0; display:flex; align-items:center; gap:6px;
    }
    .wrc-item-dot { width:8px; height:8px; border-radius:50%; flex-shrink:0; }
    .wrc-pending  .wrc-item-dot { background:#aaa; }
    .wrc-active   { background:#fff3cd; }
    .wrc-active   .wrc-item-dot { background:#fd7e14; }
    .wrc-done     { background:#d1e7dd; }
    .wrc-done     .wrc-item-dot { background:#198754; }
    .wrc-error    { background:#f8d7da; }
    .wrc-error    .wrc-item-dot { background:#dc3545; }
    .wrc-divider {
      border:none; border-top:1px solid #eee; margin:10px 0 4px;
    }
    #wrc-log {
      margin-top:8px; max-height:90px; overflow-y:auto;
      border:1px solid #eee; border-radius:4px; padding:4px 6px;
      font-size:11px; line-height:1.5;
    }
    #wrc-log .l-ok   { color:#198754; }
    #wrc-log .l-warn { color:#856404; }
    #wrc-log .l-err  { color:#dc3545; }
    #wrc-log .l-info { color:#555; }
    #wrc-link-modal {
      position:fixed; inset:0; background:rgba(0,0,0,.38);
      z-index:2147483647; display:flex; align-items:center; justify-content:center;
      font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;
    }
    #wrc-link-dialog {
      width:min(760px, calc(100vw - 36px)); max-height:calc(100vh - 50px);
      background:#fff; border-radius:8px; box-shadow:0 12px 36px rgba(0,0,0,.35);
      display:flex; flex-direction:column; color:#222; overflow:hidden;
    }
    #wrc-link-head {
      padding:12px 14px; background:#0572ce; color:#fff; display:flex;
      align-items:center; justify-content:space-between; font-weight:700;
    }
    #wrc-link-head button {
      background:rgba(255,255,255,.2); color:#fff; border:1px solid rgba(255,255,255,.5);
      border-radius:4px; cursor:pointer; padding:2px 8px; font-weight:700;
    }
    #wrc-link-tools {
      padding:10px 14px; display:flex; gap:8px; align-items:center; flex-wrap:wrap;
      border-bottom:1px solid #e5e5e5;
    }
    #wrc-link-count { margin-left:auto; font-size:12px; color:#555; }
    #wrc-link-list {
      padding:8px 14px; overflow:auto; max-height:55vh;
    }
    .wrc-link-choice {
      display:grid; grid-template-columns:22px 1fr; gap:8px; align-items:start;
      padding:8px 4px; border-bottom:1px solid #eee; font-size:13px;
    }
    .wrc-link-choice input { margin-top:2px; }
    .wrc-link-title { font-weight:650; color:#222; line-height:1.25; }
    .wrc-link-url { font-size:11px; color:#666; overflow-wrap:anywhere; margin-top:3px; }
    #wrc-link-foot {
      padding:10px 14px; border-top:1px solid #e5e5e5; display:flex;
      gap:8px; justify-content:flex-end;
    }
    #wrc-bulk-folder-name {
      border:1px solid #d0d7de; border-radius:4px; padding:7px 8px;
      min-height:18px; background:#f6f8fa; color:#222; font-size:12px;
      overflow-wrap:anywhere;
    }
    #wrc-bulk-status { font-size:11px; margin-top:5px; color:#666; }
    #wrc-bulk-status.ok { color:#198754; font-weight:600; }
    #wrc-bulk-status.err { color:#dc3545; font-weight:600; }
    #wrc-folder-search {
      width:100%; box-sizing:border-box; border:1px solid #ccc; border-radius:4px;
      padding:8px 10px; font-size:14px;
    }
    #wrc-folder-results {
      padding:8px 14px; overflow:auto; max-height:55vh;
    }
    .wrc-folder-choice {
      display:block; width:100%; text-align:left; background:#fff; color:#222;
      border:0; border-bottom:1px solid #eee; padding:9px 4px; cursor:pointer;
      font-size:13px; line-height:1.3; overflow-wrap:anywhere;
    }
    .wrc-folder-choice:hover, .wrc-folder-choice.active { background:#e7f1ff; }
    .wrc-folder-choice small { display:block; color:#666; margin-top:2px; }
  `;
  document.head.appendChild(style);

  // ── Panel HTML ─────────────────────────────────────────────────────────────
  const panel = document.createElement('div');
  panel.id = 'wrc-panel';
  panel.innerHTML = `
    <div id="wrc-header">
      <span>Resource Center Toolkit v${SCRIPT_VERSION}</span>
      <div id="wrc-header-btns">
        <button id="wrc-btn-min" title="Minimise">&#8212;</button>
        <button id="wrc-btn-close" title="Close">&#10005;</button>
      </div>
    </div>
    <div id="wrc-tabs">
      <button class="wrc-tab active" type="button" data-tab="upload">Upload</button>
      <button class="wrc-tab" type="button" data-tab="folders">Folders</button>
      <button class="wrc-tab" type="button" data-tab="links">Links</button>
      <button class="wrc-tab" type="button" data-tab="bulk">Bulk Edit</button>
    </div>
    <div id="wrc-body">

      <div class="wrc-pane active" data-pane="upload">
        <label>Queue (JSON)</label>
        <textarea id="wrc-queue-ta" rows="3"
          placeholder='Paste JSON here or use the desktop app and click Paste Queue below.'></textarea>
        <div class="wrc-row">
          <button class="wrc-btn wrc-btn-success" id="wrc-btn-paste"
            title="Read queue JSON from clipboard (copied from the desktop app)">📋 Paste Queue</button>
          <button class="wrc-btn wrc-btn-primary" id="wrc-btn-load">Load from Text</button>
        </div>
        <div id="wrc-queue-status">No queue loaded.</div>

        <hr class="wrc-divider">
        <label>Document Folder</label>
        <div style="font-size:11px;color:#666;margin-bottom:4px">
          Grant read access to the folder containing your documents.
        </div>
        <div class="wrc-row">
          <button class="wrc-btn wrc-btn-grey" id="wrc-btn-folder">Grant Folder Access</button>
          <button class="wrc-btn wrc-btn-grey" id="wrc-btn-folder-clear" title="Forget the remembered folder and pick a different one">Change Folder</button>
        </div>
        <div id="wrc-folder-status">No folder selected.</div>

        <hr class="wrc-divider">
        <div style="font-size:11px;color:#888">
          Delay between uploads: <strong>${MIN_DELAY_S}–${MAX_DELAY_S}s</strong> randomised
        </div>

        <div id="wrc-progress-section" style="display:none">
          <div id="wrc-progress-label">Ready</div>
          <div id="wrc-item-list"></div>
        </div>

        <div class="wrc-row" style="margin-top:10px">
          <button class="wrc-btn wrc-btn-success" id="wrc-btn-start" disabled>Start</button>
          <button class="wrc-btn wrc-btn-warn"    id="wrc-btn-pause" disabled>Pause</button>
          <button class="wrc-btn wrc-btn-danger"  id="wrc-btn-stop"  disabled>Stop</button>
          <button class="wrc-btn wrc-btn-grey"    id="wrc-btn-reset">Reset</button>
        </div>
      </div>

      <div class="wrc-pane" data-pane="folders">
        <label>Folder List <span style="font-weight:400;color:#888">(for dropdowns)</span></label>
        <div style="font-size:11px;color:#666;margin-bottom:5px">
          Scans every folder in the system and stores the list for the desktop app and bulk edit tools.
        </div>
        <div class="wrc-row">
          <button class="wrc-btn wrc-btn-teal" id="wrc-btn-scan">🔍 Scan Folders</button>
          <button class="wrc-btn wrc-btn-success" id="wrc-btn-copy-folders" disabled>📋 Copy Folder List</button>
          <button class="wrc-btn wrc-btn-grey" id="wrc-btn-clear-folders" disabled>Clear Saved</button>
        </div>
        <div id="wrc-scan-status">Not scanned yet.</div>
      </div>

      <div class="wrc-pane" data-pane="links">
        <label>Visible Document Links</label>
        <div style="font-size:11px;color:#666;margin-bottom:5px">
          Choose from document cards currently shown on this page and copy secure links.
        </div>
        <div class="wrc-row">
          <button class="wrc-btn wrc-btn-primary" id="wrc-btn-copy-links">🔗 Choose Links</button>
        </div>
      </div>

      <div class="wrc-pane" data-pane="bulk">
        <label>Bulk Add Visible Documents to Folder</label>
        <div style="font-size:11px;color:#666;margin-bottom:5px">
          Select a target folder, choose visible document cards, then add that folder to each selected document.
        </div>
        <div id="wrc-bulk-folder-name">No folder selected.</div>
        <div class="wrc-row">
          <button class="wrc-btn wrc-btn-grey" id="wrc-btn-bulk-folder">Choose Folder</button>
          <button class="wrc-btn wrc-btn-primary" id="wrc-btn-bulk-add">Choose Documents</button>
          <button class="wrc-btn wrc-btn-danger" id="wrc-btn-bulk-stop" disabled>Stop</button>
        </div>
        <div id="wrc-bulk-status">Scan folders first if the dropdown is empty.</div>
      </div>

      <div id="wrc-log"></div>
    </div>
  `;
  document.body.appendChild(panel);

  // ── Element shortcuts ──────────────────────────────────────────────────────
  const $ = id => panel.querySelector('#' + id);
  const elLog          = $('wrc-log');
  const elQueueStatus  = $('wrc-queue-status');
  const elFolderStatus = $('wrc-folder-status');
  const elScanStatus   = $('wrc-scan-status');
  const elProgress     = $('wrc-progress-section');
  const elProgressLbl  = $('wrc-progress-label');
  const elItemList     = $('wrc-item-list');
  const btnStart       = $('wrc-btn-start');
  const btnPause       = $('wrc-btn-pause');
  const btnStop        = $('wrc-btn-stop');
  const btnScan        = $('wrc-btn-scan');
  const btnCopyFolders = $('wrc-btn-copy-folders');
  const btnClearFolders = $('wrc-btn-clear-folders');
  const btnCopyLinks   = $('wrc-btn-copy-links');
  const btnBulkFolder  = $('wrc-btn-bulk-folder');
  const btnBulkAdd     = $('wrc-btn-bulk-add');
  const btnBulkStop    = $('wrc-btn-bulk-stop');
  const elBulkFolderName = $('wrc-bulk-folder-name');
  const elBulkStatus   = $('wrc-bulk-status');
  let selectedBulkFolder = null;
  let bulkEditRunning = false;
  let bulkEditStopRequested = false;

  // ── Logging ────────────────────────────────────────────────────────────────
  function log(msg, type = 'info') {
    const t = new Date().toLocaleTimeString('en-GB', { hour12: false });
    const div = document.createElement('div');
    div.className = `l-${type}`;
    div.textContent = `[${t}] ${msg}`;
    elLog.appendChild(div);
    elLog.scrollTop = elLog.scrollHeight;
  }

  // ── Drag to move ───────────────────────────────────────────────────────────
  let drag = false, ox = 0, oy = 0;
  $('wrc-header').addEventListener('mousedown', e => {
    if (e.target.closest('#wrc-header-btns')) return;
    drag = true;
    ox = e.clientX - panel.offsetLeft;
    oy = e.clientY - panel.offsetTop;
  });
  document.addEventListener('mousemove', e => {
    if (!drag) return;
    panel.style.right = 'auto';
    panel.style.bottom = 'auto';
    panel.style.left = (e.clientX - ox) + 'px';
    panel.style.top  = (e.clientY - oy) + 'px';
  });
  document.addEventListener('mouseup', () => { drag = false; });

  $('wrc-btn-min').addEventListener('click', () => {
    const body = $('wrc-body');
    body.style.display = body.style.display === 'none' ? '' : 'none';
  });
  $('wrc-btn-close').addEventListener('click', () => panel.remove());

  panel.querySelectorAll('.wrc-tab').forEach(btn => {
    btn.addEventListener('click', () => {
      const tab = btn.dataset.tab;
      panel.querySelectorAll('.wrc-tab').forEach(b => b.classList.toggle('active', b === btn));
      panel.querySelectorAll('.wrc-pane').forEach(p => p.classList.toggle('active', p.dataset.pane === tab));
    });
  });

  function normaliseFolderList(folders) {
    if (!Array.isArray(folders)) return [];
    return folders
      .map(f => {
        if (typeof f === 'string') return { id: '', path: f };
        return { id: String(f.id || f.folderId || ''), path: String(f.path || f.folder || f.name || '') };
      })
      .filter(f => f.path)
      .sort((a, b) => a.path.localeCompare(b.path, undefined, { sensitivity: 'base' }));
  }

  function folderCacheAgeText() {
    const raw = localStorage.getItem(LS_FOLDERS_SAVED_AT);
    if (!raw) return '';
    const d = new Date(raw);
    if (Number.isNaN(d.getTime())) return '';
    return d.toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' });
  }

  function updateFolderCacheUi() {
    lastScannedFolders = normaliseFolderList(lastScannedFolders);
    const folders = lastScannedFolders;
    const hasFolders = folders.length > 0;
    btnCopyFolders.disabled = !hasFolders;
    btnClearFolders.disabled = !hasFolders;
    btnBulkFolder.disabled = !hasFolders || bulkEditRunning;
    btnBulkAdd.disabled = !hasFolders || bulkEditRunning;
    btnBulkStop.disabled = !bulkEditRunning;

    if (!hasFolders) {
      selectedBulkFolder = null;
      elBulkFolderName.textContent = 'No folder selected.';
      if (elBulkStatus) {
        elBulkStatus.className = 'err';
        elBulkStatus.textContent = 'Scan folders first before using Bulk Edit.';
      }
      return;
    }

    const savedAt = folderCacheAgeText();
    if (elBulkStatus) {
      elBulkStatus.className = 'ok';
      elBulkStatus.textContent = `${folders.length} folders available${savedAt ? ` from saved scan at ${savedAt}` : ''}.`;
    }
    if (!selectedBulkFolder || !folders.some(f => f.path === selectedBulkFolder.folder)) {
      selectedBulkFolder = null;
      elBulkFolderName.textContent = 'No folder selected.';
    }
  }
  updateFolderCacheUi();
  if (Array.isArray(lastScannedFolders) && lastScannedFolders.length) {
    elScanStatus.className = 'ok';
    const savedAt = folderCacheAgeText();
    elScanStatus.textContent = `✓ ${lastScannedFolders.length} folders loaded from saved scan${savedAt ? ` (${savedAt})` : ''}.`;
  }

  // ── Queue loading ──────────────────────────────────────────────────────────
  function loadQueueFromText(raw) {
    try {
      const parsed = JSON.parse(raw.trim());
      if (!Array.isArray(parsed) || !parsed.length) throw new Error('Must be a non-empty array');
      queue = parsed;
      currentIndex = 0;
      saveState();
      buildItemList();
      btnStart.disabled = false;
      elQueueStatus.className = 'ok';
      elQueueStatus.textContent = `${queue.length} item(s) loaded.`;
      log(`Queue loaded: ${queue.length} document(s)`, 'ok');
    } catch (e) {
      elQueueStatus.className = 'err';
      elQueueStatus.textContent = 'Invalid JSON: ' + e.message;
    }
  }

  $('wrc-btn-load').addEventListener('click', () => {
    loadQueueFromText($('wrc-queue-ta').value);
  });

  $('wrc-btn-paste').addEventListener('click', async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (!text.trim()) { log('Clipboard is empty', 'warn'); return; }
      $('wrc-queue-ta').value = text;
      loadQueueFromText(text);
    } catch (e) {
      log('Clipboard read failed – paste manually: ' + e.message, 'warn');
    }
  });

  // ── Folder access ──────────────────────────────────────────────────────────
  function openDb() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(IDB_NAME, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(IDB_STORE);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  async function idbGet(key) {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(IDB_STORE, 'readonly');
      const req = tx.objectStore(IDB_STORE).get(key);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error);
      tx.oncomplete = () => db.close();
    });
  }

  async function idbSet(key, value) {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(IDB_STORE, 'readwrite');
      tx.objectStore(IDB_STORE).put(value, key);
      tx.oncomplete = () => { db.close(); resolve(); };
      tx.onerror = () => { db.close(); reject(tx.error); };
    });
  }

  async function idbDelete(key) {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(IDB_STORE, 'readwrite');
      tx.objectStore(IDB_STORE).delete(key);
      tx.oncomplete = () => { db.close(); resolve(); };
      tx.onerror = () => { db.close(); reject(tx.error); };
    });
  }

  async function verifyDirectoryPermission(handle, request) {
    if (!handle || !handle.queryPermission) return false;
    const opts = { mode: 'read' };
    if (await handle.queryPermission(opts) === 'granted') return true;
    if (request && handle.requestPermission) {
      return await handle.requestPermission(opts) === 'granted';
    }
    return false;
  }

  async function applyDirectoryHandle(handle, remembered) {
    dirHandle = handle;
    elFolderStatus.className = 'ok';
    elFolderStatus.textContent = `Folder: ${dirHandle.name}`;
    log(`${remembered ? 'Remembered folder restored' : 'Folder access granted'}: ${dirHandle.name}`, 'ok');
  }

  async function restoreRememberedFolder() {
    try {
      const saved = await idbGet(IDB_FOLDER_KEY);
      if (!saved) return;
      if (await verifyDirectoryPermission(saved, false)) {
        await applyDirectoryHandle(saved, true);
      } else {
        elFolderStatus.className = '';
        elFolderStatus.textContent = `Remembered folder: ${saved.name}. Click Grant Folder Access to reconnect.`;
      }
    } catch (_) {}
  }

  $('wrc-btn-folder').addEventListener('click', async () => {
    try {
      const saved = await idbGet(IDB_FOLDER_KEY).catch(() => null);
      if (saved && await verifyDirectoryPermission(saved, true)) {
        await applyDirectoryHandle(saved, true);
        return;
      }

      const picked = await window.showDirectoryPicker({ mode: 'read' });
      await idbSet(IDB_FOLDER_KEY, picked);
      await applyDirectoryHandle(picked, false);
    } catch (e) {
      if (e.name !== 'AbortError') log('Folder access error: ' + e.message, 'err');
    }
  });

  $('wrc-btn-folder-clear').addEventListener('click', async () => {
    try {
      await idbDelete(IDB_FOLDER_KEY);
      dirHandle = null;
      elFolderStatus.className = '';
      elFolderStatus.textContent = 'No folder selected.';
      log('Remembered folder cleared', 'ok');

      const picked = await window.showDirectoryPicker({ mode: 'read' });
      await idbSet(IDB_FOLDER_KEY, picked);
      await applyDirectoryHandle(picked, false);
    } catch (e) {
      if (e.name !== 'AbortError') log('Folder access error: ' + e.message, 'err');
    }
  });
  restoreRememberedFolder();

  // ── Build item list UI ─────────────────────────────────────────────────────
  function buildItemList() {
    elItemList.innerHTML = '';
    queue.forEach((item, i) => {
      const div = document.createElement('div');
      div.className = 'wrc-item wrc-pending';
      div.id = `wrc-item-${i}`;
      div.innerHTML = `<span class="wrc-item-dot"></span><span>${i + 1}. ${esc(item.displayName || item.file)}</span>`;
      elItemList.appendChild(div);
    });
    for (let i = 0; i < currentIndex; i++) setStatus(i, 'done', 'restored');
    elProgress.style.display = '';
  }

  function setStatus(i, cls, note) {
    const el = document.getElementById(`wrc-item-${i}`);
    if (!el) return;
    el.className = `wrc-item wrc-${cls}`;
    const label = queue[i] ? `${i + 1}. ${esc(queue[i].displayName || queue[i].file)}` : '';
    el.innerHTML = `<span class="wrc-item-dot"></span><span>${label}${note ? ' — ' + note : ''}</span>`;
  }

  function esc(s) {
    return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  }

  function saveState() {
    try {
      localStorage.setItem(LS_QUEUE, JSON.stringify(queue));
      localStorage.setItem(LS_INDEX, String(currentIndex));
    } catch (_) {}
  }

  function clearState() {
    localStorage.removeItem(LS_QUEUE);
    localStorage.removeItem(LS_INDEX);
  }

  // ── Utility ────────────────────────────────────────────────────────────────
  const sleep = ms => new Promise(r => setTimeout(r, ms));

  function randomDelay() {
    return (MIN_DELAY_S + Math.random() * (MAX_DELAY_S - MIN_DELAY_S)) * 1000;
  }

  async function findFileRecursive(dir, name, depth = 0) {
    if (depth > 6) return null;
    try {
      return await (await dir.getFileHandle(name, { create: false })).getFile();
    } catch (_) {}
    for await (const [, handle] of dir.entries()) {
      if (handle.kind === 'directory') {
        const found = await findFileRecursive(handle, name, depth + 1);
        if (found) return found;
      }
    }
    return null;
  }

  async function getFile(filename) {
    if (!dirHandle) throw new Error('No folder access – click "Grant Folder Access" first');
    const parts = filename.replace(/\\/g, '/').split('/');
    // If the queue item includes a subfolder path, traverse it directly
    if (parts.length > 1) {
      let dir = dirHandle;
      for (let i = 0; i < parts.length - 1; i++)
        dir = await dir.getDirectoryHandle(parts[i], { create: false });
      return (await dir.getFileHandle(parts[parts.length - 1], { create: false })).getFile();
    }
    // Bare filename — search the whole tree
    const file = await findFileRecursive(dirHandle, parts[0]);
    if (!file) throw new Error(`"${parts[0]}" not found in granted folder or any subfolder`);
    return file;
  }

  // ── Find the manage-document iframe ───────────────────────────────────────
  function findIframe() {
    return Array.from(document.querySelectorAll('iframe'))
      .find(f => (f.src || '').includes('manage-document'));
  }

  function waitForForm() {
    return new Promise((resolve, reject) => {
      const deadline = Date.now() + IFRAME_TIMEOUT_MS;
      const tick = () => {
        const iframe = findIframe();
        if (iframe) {
          const doc = iframe.contentDocument;
          if (doc && doc.getElementById('P5_DISPLAY_NAME')) { resolve(iframe); return; }
        }
        if (Date.now() > deadline) { reject(new Error('Upload form did not appear in time')); return; }
        setTimeout(tick, 400);
      };
      tick();
    });
  }

  function isSavedEditForm(doc) {
    const buttons = Array.from(doc.querySelectorAll('button, input[type="submit"], input[type="button"]'));
    const hasApplyChanges = buttons.some(el =>
      /apply\s+changes/i.test((el.textContent || el.value || '').trim())
    );
    const hasDelete = buttons.some(el =>
      /^delete$/i.test((el.textContent || el.value || '').trim())
    );
    return hasApplyChanges || hasDelete;
  }

  function waitForClose(iframe) {
    return new Promise((resolve, reject) => {
      const deadline = Date.now() + SUBMIT_TIMEOUT_MS;
      setTimeout(() => {
        const tick = () => {
          const currentIframe = findIframe();
          if (!currentIframe) { resolve('closed'); return; }
          try {
            const doc = (iframe || currentIframe).contentDocument;
            if (doc && isSavedEditForm(doc)) { resolve('saved'); return; }
          } catch (_) {}
          if (Date.now() > deadline) { reject(new Error('Upload did not complete within timeout')); return; }
          setTimeout(tick, 600);
        };
        tick();
      }, 1000);
    });
  }

  function waitForManageDocumentClosed(timeoutMs = SUBMIT_TIMEOUT_MS) {
    return new Promise((resolve, reject) => {
      const deadline = Date.now() + timeoutMs;
      const tick = () => {
        if (!findIframe()) { resolve('closed'); return; }
        if (Date.now() > deadline) {
          reject(new Error('Edit form did not close after Apply Changes'));
          return;
        }
        setTimeout(tick, 600);
      };
      setTimeout(tick, 1000);
    });
  }

  function normaliseText(value) {
    return String(value || '').replace(/\s+/g, ' ').trim().toLowerCase();
  }

  function itemNeedles(item) {
    return [item.displayName, item.file]
      .filter(Boolean)
      .map(normaliseText)
      .filter(Boolean);
  }

  function cardForElement(el) {
    return el.closest('.a-CardView-item, .t-Card, li, article, .a-CardView, .t-CardsRegion') || el.parentElement;
  }

  function findEditLinkForItem(item) {
    const needles = itemNeedles(item);
    const links = Array.from(document.querySelectorAll('a[href*="manage-document"][href*="p5_rc_file_metadata_id"]'));
    for (const link of links) {
      const card = cardForElement(link);
      const text = normaliseText(card ? card.textContent : link.textContent);
      if (needles.some(n => text.includes(n))) return link;
    }
    return null;
  }

  async function waitForEditLink(item, timeoutMs = 90000) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const link = findEditLinkForItem(item);
      if (link) return link;
      await sleep(1000);
    }
    throw new Error('Uploaded document card/edit link did not appear in time');
  }

  async function openEditFormForItem(item) {
    const link = await waitForEditLink(item);
    jqClick(link);
    return waitForForm();
  }

  function setItemValue(doc, ifWin, id, value) {
    const el = doc.getElementById(id);
    if (!el) return false;
    const nativeSet = Object.getOwnPropertyDescriptor(
      el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype,
      'value'
    )?.set;
    if (nativeSet) nativeSet.call(el, value);
    else el.value = value;
    el.dispatchEvent(new InputEvent('input',  { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    try {
      if (ifWin && ifWin.apex && ifWin.apex.item) {
        ifWin.apex.item(id).setValue(value, null, true);
      }
    } catch (_) {}
    return true;
  }

  function folderLabel(folder) {
    return folder.folder || folder.path || folder.name || '';
  }

  function folderId(folder) {
    return folder.folderId || folder.id || '';
  }

  async function revealAdditionalFolderPanel(doc, ifWin) {
    const field = doc.getElementById('P5_ADD_TAXONOMY_ID');
    if (field && field.offsetParent !== null) return;
    const btn = doc.getElementById('B60977312592241230')
      || Array.from(doc.querySelectorAll('button, input[type="button"]'))
        .find(el => /add to other folders/i.test((el.textContent || el.value || '').trim()));
    if (btn) {
      jqClick(btn, ifWin);
      await sleep(400);
    }
  }

  function additionalFolderListed(doc, label, fid) {
    const wanted = normaliseText(label || fid);
    if (!wanted) return false;
    const rows = Array.from(doc.querySelectorAll('tr, .a-GV-row, .a-IRR-table tr'));
    return rows.some(row => {
      const text = normaliseText(row.textContent || '');
      if (!text.includes(wanted)) return false;
      return /delete selected|select|folder/.test(text) || row.querySelector('input[type="checkbox"]');
    });
  }

  async function addAdditionalFolder(iframe, folder) {
    const doc = iframe.contentDocument;
    const ifWin = iframe.contentWindow;
    const label = folderLabel(folder);
    const fid = String(folderId(folder) || '');
    if (!label && !fid) throw new Error('Additional folder has no folder name or ID');

    await revealAdditionalFolderPanel(doc, ifWin);

    if (fid) {
      setItemValue(doc, ifWin, 'P5_ADD_TAXONOMY_ID', label || fid);
      setItemValue(doc, ifWin, 'P5_ADD_TAXONOMY_ID_HIDDENVALUE', fid);
    } else {
      await selectAdditionalFolderViaLOV(doc, label, ifWin);
    }

    const before = Number(doc.getElementById('P5_TAXON_COUNT')?.value || 0);
    const addBtn = doc.getElementById('B71771510520216308')
      || Array.from(doc.querySelectorAll('button, input[type="button"], input[type="submit"]'))
        .find(el => /add document to folder/i.test((el.textContent || el.value || '').trim()));
    if (!addBtn) throw new Error('Add Document to Folder button not found');
    jqClick(addBtn, ifWin);

    const deadline = Date.now() + 5000;
    let detected = false;
    while (Date.now() < deadline) {
      const current = Number(doc.getElementById('P5_TAXON_COUNT')?.value || 0);
      const hidden = doc.getElementById('P5_ADD_TAXONOMY_ID_HIDDENVALUE')?.value || '';
      if (current > before || !hidden || additionalFolderListed(doc, label, fid)) {
        detected = true;
        break;
      }
      await sleep(200);
    }
    log(`Additional folder ${detected ? 'added' : 'queued'}: ${label || fid}`, 'ok');
  }

  function findAdditionalFolderLovButton(formDoc) {
    return formDoc.querySelector('#P5_ADD_TAXONOMY_ID_lov_btn');
  }

  async function selectAdditionalFolderViaLOV(formDoc, folderSearch, ifWin) {
    const lovBtn = findAdditionalFolderLovButton(formDoc);
    if (!lovBtn) throw new Error('Additional folder LOV button not found');

    _openedPopups = [];
    await openFolderLov(lovBtn, ifWin);

    const lovDoc = await findLovSource(6000);
    if (!lovDoc) throw new Error('Additional folder LOV popup not found');

    const searchBox = lovDoc.querySelector(
      'input[type="search"], input[name="f01"], input[type="text"]'
    );
    if (searchBox) {
      searchBox.value = folderSearch;
      searchBox.dispatchEvent(new InputEvent('input',  { bubbles: true }));
      searchBox.dispatchEvent(new Event('change', { bubbles: true }));
      const goBtn = lovDoc.querySelector('button.a-PopupLOV-doSearch, button[type="submit"], input[type="submit"], button');
      if (goBtn) goBtn.click();
      await sleep(800);
    }

    const dataRows = Array.from(lovDoc.querySelectorAll('tr[data-id]'));
    const wanted = normaliseText(folderSearch);
    const row = dataRows.find(tr => normaliseText(tr.textContent).includes(wanted)) || dataRows[0];
    if (!row) throw new Error(`No folder results for "${folderSearch}"`);
    row.click();
    await sleep(400);
  }

  async function applyAdditionalFolders(item) {
    const folders = Array.isArray(item.additionalFolders) ? item.additionalFolders : [];
    if (!folders.length) return true;

    log(`Opening saved document to add ${folders.length} extra folder(s)…`, 'info');
    const iframe = await openEditFormForItem(item);
    log('Edit form ready for extra folders', 'ok');

    for (const folder of folders) {
      await addAdditionalFolder(iframe, folder);
      await sleep(300);
    }

    const doc = iframe.contentDocument;
    const applyBtn = doc.getElementById('B423367462691789907')
      || Array.from(doc.querySelectorAll('button, input[type="button"], input[type="submit"]'))
        .find(el => /apply changes/i.test((el.textContent || el.value || '').trim()));
    if (!applyBtn) throw new Error('Apply Changes button not found');
    jqClick(applyBtn, iframe.contentWindow);
    log('Extra folders submitted – waiting for confirmation…', 'info');
    await waitForClose(iframe);
    log(`Extra folders saved for "${item.displayName || item.file}"`, 'ok');
    return true;
  }

  // ── Trigger a click via jQuery (APEX menus are jQuery widgets; isTrusted irrelevant) ──
  function getJq(win) {
    return (win && (win.$ || win.jQuery)) || window.$ || window.jQuery || null;
  }

  function jqClick(el, win) {
    const jq = getJq(win);
    if (jq) {
      jq(el).trigger(jq.Event('mousedown', { bubbles: true, which: 1, button: 0 }));
      jq(el).trigger(jq.Event('mouseup',   { bubbles: true, which: 1, button: 0 }));
      jq(el).trigger(jq.Event('click',     { bubbles: true, which: 1, button: 0 }));
    } else {
      el.click();
    }
  }

  function findFolderLovButton(formDoc) {
    return formDoc.querySelector(
      '#P5_TAXONOMY_ID_lov_btn, ' +
      'button.a-Button--popupLOV, a.a-Button--popupLOV, ' +
      'button[id*="TAXONOMY"][id*="btn"], ' +
      'a[id*="TAXONOMY"][id*="btn"], ' +
      'button.a-Button--lovButton, a.a-Button--lovButton, ' +
      '.t-Form-fieldContainer a.a-Button[href="#"]'
    );
  }

  function invokeDirectJqHandlers(el, win) {
    const jq = getJq(win);
    if (!jq || !jq._data) return false;
    const events = jq._data(el, 'events');
    if (!events || !events.click) return false;

    let invoked = false;
    for (const h of events.click) {
      if (typeof h.handler !== 'function') continue;
      h.handler.call(el, jq.Event('click', { target: el, currentTarget: el, which: 1, button: 0 }));
      invoked = true;
    }
    return invoked;
  }

  async function openFolderLov(lovBtn, ifWin) {
    const jq = getJq(ifWin);
    const doc = lovBtn.ownerDocument;
    const field = doc.getElementById('P5_TAXONOMY_ID');
    const icon = lovBtn.querySelector('.a-Icon');
    const candidates = [lovBtn, icon, field].filter(Boolean);

    for (const el of candidates) {
      try { if (typeof el.focus === 'function') el.focus(); } catch (_) {}

      if (jq) {
        const $el = jq(el);
        $el.trigger('focus');
        $el.trigger(jq.Event('mouseenter', { bubbles: true }));
        $el.trigger(jq.Event('mouseover',  { bubbles: true }));
        $el.trigger(jq.Event('mousedown',  { bubbles: true, which: 1, button: 0 }));
        $el.trigger(jq.Event('mouseup',    { bubbles: true, which: 1, button: 0 }));
        $el.trigger('click');
      } else {
        jqClick(el, ifWin);
      }

      try {
        if (ifWin && ifWin.apex && ifWin.apex.event) {
          ifWin.apex.event.trigger(el, 'click');
        }
      } catch (_) {}

      try { invokeDirectJqHandlers(el, ifWin); } catch (_) {}
      await sleep(250);
    }
  }

  // ── Click "Add Document" and pick the file upload menu item ───────────────
  async function openForm() {
    const btn = document.querySelector('[data-test="1-add-document-btn"]')
             || document.getElementById('B52696165037068962')
             || (() => {
               for (const b of document.querySelectorAll('button, a.a-Button')) {
                 const t = (b.textContent || b.getAttribute('aria-label') || '').trim();
                 if (t === '+' || t.toLowerCase() === 'add') return b;
               }
               return null;
             })();
    if (!btn) throw new Error('"Add Document" button not found on page');

    jqClick(btn);
    await sleep(800);

    const isAddDocument = el => {
      const txt = (el.textContent || el.innerText || '').replace(/\s+/g, ' ').trim().toLowerCase();
      return txt === 'add document';
    };

    let picked = false;
    for (const sel of ['button.a-Menu-label', 'button[role="menuitem"]', '.a-Menu-item button']) {
      for (const el of document.querySelectorAll(sel)) {
        if (isAddDocument(el)) { jqClick(el); picked = true; break; }
      }
      if (picked) break;
    }

    if (!picked) log('WARNING: Could not find "Add Document" menu item', 'warn');
  }

  // ── Cancel / close the form (for after scanning) ──────────────────────────
  async function cancelForm() {
    const iframe = findIframe();
    if (!iframe) return;
    const doc = iframe.contentDocument;
    const cancelBtn = doc.querySelector(
      'button[data-action="CANCEL"], button[title*="Cancel"], ' +
      '.t-Button--cancel, a.t-Button--cancel, ' +
      'button.t-Button--hot[type="button"]'
    );
    if (cancelBtn) {
      jqClick(cancelBtn, iframe.contentWindow);
    } else {
      // Try to find a Close / × button in the outer page dialog
      const closeBtn = document.querySelector(
        '[aria-label="Close"], button[title="Close"], .a-Dialog-close'
      );
      if (closeBtn) closeBtn.click();
    }
  }

  // ── Scrape folder rows from an APEX GV (Grid View) LOV ───────────────────
  // Rows are <tr data-id="NNN"> — no onclick or links needed.
  function scrapeFolderRows(doc) {
    const folders = [];
    const seen = new Set();

    // Only select rows that have a data-id (skips header <th> rows automatically)
    const rows = doc.querySelectorAll('tr[data-id]');
    for (const tr of rows) {
      const id   = tr.dataset.id || '';
      // First cell holds the folder path text
      const cell = tr.querySelector('td');
      const path = cell ? cell.textContent.trim() : '';
      if (!path || seen.has(path)) continue;
      seen.add(path);
      folders.push({ id, path });
    }

    return folders;
  }

  // ── Find the LOV popup (window or iframe) ─────────────────────────────────
  async function findLovSource(timeoutMs = 6000) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      // 1. Popup windows intercepted by our window.open override
      for (const w of _openedPopups) {
        try {
          if (!w.closed && w.document && w.document.readyState !== 'loading') {
            const rows = w.document.querySelectorAll('table tr td');
            if (rows.length) return w.document;
          }
        } catch (_) {}
      }

      // 2. LOV iframe injected into the main page
      const lovIframe = Array.from(document.querySelectorAll('iframe'))
        .find(f => {
          const s = (f.src || f.name || f.id || '').toLowerCase();
          return s.includes('lov') || s.includes('popup');
        });
      if (lovIframe) {
        try {
          const d = lovIframe.contentDocument;
          if (d && d.querySelector('table tr td')) return d;
        } catch (_) {}
      }

      // 3. Inline APEX LOV modal within the main page
      const inlineTable = document.querySelector(
        '.a-Popup table, .a-LOV table, [class*="lov"] table, ' +
        '#apex_popup_table, .apex_lov table'
      );
      if (inlineTable) return document;

      await sleep(200);
    }
    return null;
  }

  // ── Load ALL results: clear filter, submit, then exhaust "Show More" pages ──
  async function lovLoadAll(lovDoc, statusCb) {
    // 1. Clear the search box and submit to get the full unfiltered list
    const searchBox = lovDoc.querySelector(
      'input[type="search"], input[name="f01"], input[id*="search"], input[type="text"]'
    );
    if (searchBox) {
      searchBox.value = '';
      searchBox.dispatchEvent(new InputEvent('input',  { bubbles: true }));
      searchBox.dispatchEvent(new Event('change', { bubbles: true }));
      const goBtn = lovDoc.querySelector(
        'button[type="submit"], input[type="submit"], button#GO, button[value="Go"], button'
      );
      if (goBtn) { goBtn.click(); await sleep(900); }
    }

    // 2. Keep clicking "Show More" until it disappears
    let page = 1;
    for (let safety = 0; safety < 50; safety++) {
      const showMoreBtn = Array.from(lovDoc.querySelectorAll('button, input[type="button"]'))
        .find(b => /show\s*more/i.test((b.textContent || b.value || '').trim()));
      if (!showMoreBtn) break;

      page++;
      if (statusCb) statusCb(`Loading page ${page}…`);
      showMoreBtn.click();
      // Wait for new rows to append (APEX typically adds them without a page reload)
      await sleep(700);
    }
  }

  // ── Scan Folders ───────────────────────────────────────────────────────────
  // Opens the Add Document form, clicks the Folder field LOV, reads all rows,
  // copies JSON to clipboard, then cancels the form.
  btnScan.addEventListener('click', async () => {
    btnScan.disabled = true;
    elScanStatus.className = '';
    elScanStatus.textContent = 'Opening form…';
    _openedPopups = [];

    try {
      // 1. Open the form
      try {
        await openForm();
      } catch (e) {
        log('Scan: cannot open form – ' + e.message, 'err');
        elScanStatus.textContent = 'Failed: could not open Add Document form.';
        btnScan.disabled = false;
        return;
      }

      // 2. Wait for iframe + form fields
      let iframe;
      try {
        iframe = await waitForForm();
      } catch (e) {
        log('Scan: form timeout – ' + e.message, 'err');
        elScanStatus.textContent = 'Failed: form did not load.';
        btnScan.disabled = false;
        return;
      }

      // 3. Also intercept window.open calls from within the form iframe (same origin)
      try {
        const ifWin = iframe.contentWindow;
        const _origIfOpen = ifWin.open.bind(ifWin);
        ifWin.open = function (...args) {
          const w = _origIfOpen(...args);
          if (w) _openedPopups.push(w);
          return w;
        };
      } catch (_) {}

      const formDoc = iframe.contentDocument;
      elScanStatus.textContent = 'Form open – clicking Folder field…';

      // 4. Find and click the LOV trigger button for the Folder/Taxonomy field
      const lovBtn = findFolderLovButton(formDoc);
      if (!lovBtn) {
        log('Scan: Folder LOV button not found', 'err');
        elScanStatus.textContent = 'Failed: Folder LOV button not found.';
        await cancelForm();
        btnScan.disabled = false;
        return;
      }

      await openFolderLov(lovBtn, iframe.contentWindow);
      elScanStatus.textContent = 'Waiting for folder popup…';

      // 5. Wait for the LOV popup to appear
      const lovDoc = await findLovSource(7000);
      if (!lovDoc) {
        log('Scan: folder popup did not appear', 'err');
        elScanStatus.textContent = 'Failed: folder popup did not appear. Try clicking the folder field manually first.';
        await cancelForm();
        btnScan.disabled = false;
        return;
      }

      // 6. Clear filter, load all, exhaust pagination
      elScanStatus.textContent = 'Loading all folders…';
      await lovLoadAll(lovDoc, msg => { elScanStatus.textContent = msg; });

      // 7. Scrape
      const folders = scrapeFolderRows(lovDoc);
      log(`Scanned ${folders.length} folder(s)`, folders.length ? 'ok' : 'warn');

      if (!folders.length) {
        elScanStatus.textContent = 'No folders found in popup – try again while the popup is open.';
        await cancelForm();
        btnScan.disabled = false;
        return;
      }

      // 8. Store result and enable the Copy button (clipboard needs a direct click)
      lastScannedFolders = normaliseFolderList(folders);
      try {
        localStorage.setItem(LS_FOLDERS, JSON.stringify(lastScannedFolders));
        localStorage.setItem(LS_FOLDERS_SAVED_AT, new Date().toISOString());
      } catch (_) {}
      updateFolderCacheUi();
      elScanStatus.className = 'ok';
      elScanStatus.textContent = `✓ ${lastScannedFolders.length} folders saved in this browser — click Copy Folder List only when the desktop app needs it.`;
      log(`Scan complete: ${lastScannedFolders.length} folders found and saved`, 'ok');

      // 9. Close the LOV popup window(s)
      for (const w of _openedPopups) {
        try { if (!w.closed) w.close(); } catch (_) {}
      }
      _openedPopups = [];

      // 10. Cancel the upload form
      await sleep(400);
      await cancelForm();

    } catch (e) {
      log('Scan error: ' + e.message, 'err');
      elScanStatus.textContent = 'Error: ' + e.message;
    }

    btnScan.disabled = false;
  });

  // ── Copy scanned folder list to clipboard (direct user gesture = always works) ──
  btnCopyFolders.addEventListener('click', async () => {
    if (!lastScannedFolders) return;
    try {
      await navigator.clipboard.writeText(JSON.stringify(lastScannedFolders, null, 2));
      const orig = btnCopyFolders.textContent;
      btnCopyFolders.textContent = '✓ Copied!';
      btnCopyFolders.style.background = '#0d9488';
      setTimeout(() => {
        btnCopyFolders.textContent = orig;
        btnCopyFolders.style.background = '';
      }, 2000);
      log(`${lastScannedFolders.length} folders copied to clipboard`, 'ok');
    } catch (e) {
      log('Clipboard write failed: ' + e.message, 'err');
    }
  });

  btnClearFolders.addEventListener('click', () => {
    lastScannedFolders = [];
    selectedBulkFolder = null;
    localStorage.removeItem(LS_FOLDERS);
    localStorage.removeItem(LS_FOLDERS_SAVED_AT);
    updateFolderCacheUi();
    elScanStatus.className = '';
    elScanStatus.textContent = 'Saved folder scan cleared. Scan Folders when you need a fresh list.';
    log('Saved folder scan cleared', 'ok');
  });

  // ── Copy secure links from currently visible document cards ───────────────
  function secureLinkPrefix() {
    const fromPage = document.getElementById('P1_DOWNLOAD_PREFIX')?.value || '';
    if (fromPage) return fromPage;
    return location.origin + '/app/r/westminster/resource_centre/secure?document=';
  }

  function cardContainerForLink(link) {
    return link.closest('.a-CardView-item, li, article, .t-Card, .a-CardView-card, .a-CardView') || link.parentElement;
  }

  function titleForCard(card, hash) {
    if (!card) return hash;
    const titleLink = Array.from(card.querySelectorAll('a[title], a[href*="DOWNLOAD_FILE"]'))
      .find(a => {
        const href = a.getAttribute('href') || '';
        return !href.includes('openCopyLinkPopup') && !href.includes('manage-document');
      });
    const title = (titleLink?.getAttribute('title') || titleLink?.textContent || '').replace(/\s+/g, ' ').trim();
    if (title) return title;

    const text = (card.textContent || '').replace(/\s+/g, ' ').trim();
    return text.split(' Published:')[0].split(' Key Document')[0].trim() || hash;
  }

  function collectVisibleDocumentLinks() {
    const prefix = secureLinkPrefix();
    const seen = new Set();
    const rows = [];
    const chainLinks = Array.from(document.querySelectorAll('a[href^="javascript:openCopyLinkPopup"]'));

    for (const link of chainLinks) {
      const href = link.getAttribute('href') || '';
      const m = href.match(/openCopyLinkPopup\(['"]([^'"]+)['"]\)/);
      if (!m) continue;
      const hash = m[1];
      if (!hash || seen.has(hash)) continue;
      seen.add(hash);
      const card = cardContainerForLink(link);
      rows.push({
        title: titleForCard(card, hash),
        url: prefix + hash
      });
    }
    return rows;
  }

  function metadataIdFromHref(href) {
    const decoded = decodeURIComponent(String(href || ''));
    const m = decoded.match(/p5_rc_file_metadata_id=(\d+)/i);
    return m ? m[1] : '';
  }

  function editLinkForCard(card) {
    if (!card) return null;
    return card.querySelector('a[href*="manage-document"][href*="p5_rc_file_metadata_id"]');
  }

  function collectVisibleDocuments() {
    const prefix = secureLinkPrefix();
    const seen = new Set();
    const rows = [];
    const chainLinks = Array.from(document.querySelectorAll('a[href^="javascript:openCopyLinkPopup"]'));

    for (const link of chainLinks) {
      const href = link.getAttribute('href') || '';
      const m = href.match(/openCopyLinkPopup\(['"]([^'"]+)['"]\)/);
      if (!m) continue;
      const hash = m[1];
      const card = cardContainerForLink(link);
      const editLink = editLinkForCard(card);
      const metadataId = metadataIdFromHref(editLink?.getAttribute('href') || '');
      const key = metadataId || hash;
      if (!key || seen.has(key) || !editLink) continue;
      seen.add(key);
      rows.push({
        title: titleForCard(card, hash),
        url: prefix + hash,
        hash,
        metadataId,
        editHref: editLink.getAttribute('href') || ''
      });
    }
    return rows;
  }

  function closeLinkChooser() {
    document.getElementById('wrc-link-modal')?.remove();
  }

  function selectedLinkRows(modal, rows) {
    return Array.from(modal.querySelectorAll('.wrc-link-check'))
      .map((cb, i) => cb.checked ? rows[i] : null)
      .filter(Boolean);
  }

  function updateLinkCount(modal, rows) {
    const selected = selectedLinkRows(modal, rows).length;
    const count = modal.querySelector('#wrc-link-count');
    if (count) count.textContent = `${selected}/${rows.length} selected`;
  }

  function openLinkChooser(rows) {
    closeLinkChooser();

    const modal = document.createElement('div');
    modal.id = 'wrc-link-modal';
    modal.innerHTML = `
      <div id="wrc-link-dialog" role="dialog" aria-modal="true" aria-label="Choose document links">
        <div id="wrc-link-head">
          <span>Choose Document Links</span>
          <button type="button" id="wrc-link-x">×</button>
        </div>
        <div id="wrc-link-tools">
          <button class="wrc-btn wrc-btn-grey" type="button" id="wrc-link-all">Select All</button>
          <button class="wrc-btn wrc-btn-grey" type="button" id="wrc-link-none">Select None</button>
          <span id="wrc-link-count"></span>
        </div>
        <div id="wrc-link-list"></div>
        <div id="wrc-link-foot">
          <button class="wrc-btn wrc-btn-grey" type="button" id="wrc-link-cancel">Close</button>
          <button class="wrc-btn wrc-btn-success" type="button" id="wrc-link-copy">Copy Selected</button>
        </div>
      </div>
    `;

    const list = modal.querySelector('#wrc-link-list');
    rows.forEach((row, i) => {
      const div = document.createElement('label');
      div.className = 'wrc-link-choice';
      div.innerHTML = `
        <input class="wrc-link-check" type="checkbox" checked data-index="${i}">
        <span>
          <span class="wrc-link-title">${esc(row.title)}</span>
          <span class="wrc-link-url">${esc(row.url)}</span>
        </span>
      `;
      list.appendChild(div);
    });

    modal.querySelector('#wrc-link-x').addEventListener('click', closeLinkChooser);
    modal.querySelector('#wrc-link-cancel').addEventListener('click', closeLinkChooser);
    modal.addEventListener('click', e => {
      if (e.target === modal) closeLinkChooser();
    });
    modal.querySelector('#wrc-link-all').addEventListener('click', () => {
      modal.querySelectorAll('.wrc-link-check').forEach(cb => { cb.checked = true; });
      updateLinkCount(modal, rows);
    });
    modal.querySelector('#wrc-link-none').addEventListener('click', () => {
      modal.querySelectorAll('.wrc-link-check').forEach(cb => { cb.checked = false; });
      updateLinkCount(modal, rows);
    });
    modal.querySelectorAll('.wrc-link-check').forEach(cb => {
      cb.addEventListener('change', () => updateLinkCount(modal, rows));
    });
    modal.querySelector('#wrc-link-copy').addEventListener('click', async () => {
      const selected = selectedLinkRows(modal, rows);
      if (!selected.length) {
        log('No document links selected', 'warn');
        return;
      }
      const text = selected.map(r => `${r.title}\n${r.url}`).join('\n\n');
      try {
        await navigator.clipboard.writeText(text);
        log(`${selected.length} selected document link(s) copied`, 'ok');
        closeLinkChooser();
      } catch (e) {
        log('Link clipboard write failed: ' + e.message, 'err');
      }
    });

    document.body.appendChild(modal);
    updateLinkCount(modal, rows);
  }

  btnCopyLinks.addEventListener('click', () => {
    const rows = collectVisibleDocumentLinks();
    if (!rows.length) {
      log('No visible secure document links found on this page', 'warn');
      return;
    }
    openLinkChooser(rows);
  });

  function findEditLinkForVisibleDocument(row) {
    const links = Array.from(document.querySelectorAll('a[href*="manage-document"][href*="p5_rc_file_metadata_id"]'));
    if (row?.metadataId) {
      const byId = links.find(link => metadataIdFromHref(link.getAttribute('href') || '') === row.metadataId);
      if (byId) return byId;
    }
    if (row?.editHref) {
      const byHref = links.find(link => (link.getAttribute('href') || '') === row.editHref);
      if (byHref) return byHref;
    }
    const wanted = normaliseText(row?.title || '');
    if (wanted) {
      for (const link of links) {
        const card = cardContainerForLink(link);
        if (normaliseText(card ? card.textContent : link.textContent).includes(wanted)) return link;
      }
    }
    return null;
  }

  async function waitForVisibleDocumentEditLink(row, timeoutMs = 30000) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const link = findEditLinkForVisibleDocument(row);
      if (link) return link;
      await sleep(500);
    }
    throw new Error(`Edit link not found after page refresh for "${row?.title || 'document'}"`);
  }

  async function openEditFormForVisibleDocument(row) {
    if (findIframe()) await waitForManageDocumentClosed(10000);
    const link = await waitForVisibleDocumentEditLink(row);
    jqClick(link);
    return waitForForm();
  }

  async function applyAdditionalFolderToVisibleDocument(row, folder) {
    log(`Bulk edit: opening "${row.title}"`, 'info');
    const iframe = await openEditFormForVisibleDocument(row);
    log(`Bulk edit: form ready for "${row.title}"`, 'ok');
    await addAdditionalFolder(iframe, folder);

    const doc = iframe.contentDocument;
    const applyBtn = doc.getElementById('B423367462691789907')
      || Array.from(doc.querySelectorAll('button, input[type="button"], input[type="submit"]'))
        .find(el => /apply changes/i.test((el.textContent || el.value || '').trim()));
    if (!applyBtn) throw new Error('Apply Changes button not found');
    jqClick(applyBtn, iframe.contentWindow);
    log(`Bulk edit: apply clicked for "${row.title}"`, 'info');
    await waitForManageDocumentClosed();
    await sleep(1000);
    log(`Bulk edit: saved "${row.title}"`, 'ok');
  }

  async function runBulkFolderAdd(rows, folder) {
    bulkEditRunning = true;
    bulkEditStopRequested = false;
    btnBulkAdd.disabled = true;
    btnBulkFolder.disabled = true;
    btnBulkStop.disabled = false;
    if (elBulkStatus) {
      elBulkStatus.className = '';
      elBulkStatus.textContent = `Bulk edit starting: 0/${rows.length} updated.`;
    }

    let done = 0;
    let failed = 0;
    for (let i = 0; i < rows.length; i++) {
      if (bulkEditStopRequested) {
        log(`Bulk edit stopped before "${rows[i].title}"`, 'warn');
        break;
      }
      if (elBulkStatus) {
        elBulkStatus.className = '';
        elBulkStatus.textContent = `Bulk edit ${i + 1}/${rows.length}: ${rows[i].title}`;
      }
      try {
        await applyAdditionalFolderToVisibleDocument(rows[i], folder);
        done++;
      } catch (e) {
        failed++;
        log(`Bulk edit failed for "${rows[i].title}": ${e.message}`, 'err');
      }
      if (i < rows.length - 1 && !bulkEditStopRequested) await sleep(2500);
    }

    if (elBulkStatus) {
      elBulkStatus.className = bulkEditStopRequested || failed ? 'err' : 'ok';
      if (bulkEditStopRequested) {
        elBulkStatus.textContent = `Bulk edit stopped: ${done}/${rows.length} updated, ${failed} failed.`;
      } else {
        elBulkStatus.textContent = `Bulk edit complete: ${done}/${rows.length} updated, ${failed} failed.`;
      }
    }
    bulkEditRunning = false;
    bulkEditStopRequested = false;
    btnBulkStop.disabled = true;
    updateFolderCacheUi();
  }

  function selectedVisibleDocuments(modal, rows) {
    return Array.from(modal.querySelectorAll('.wrc-link-check'))
      .map((cb, i) => cb.checked ? rows[i] : null)
      .filter(Boolean);
  }

  function openBulkFolderChooser() {
    const folders = normaliseFolderList(lastScannedFolders);
    if (!folders.length) {
      log('No saved folder list available. Run Scan Folders first.', 'warn');
      return;
    }
    closeLinkChooser();

    const modal = document.createElement('div');
    modal.id = 'wrc-link-modal';
    modal.innerHTML = `
      <div id="wrc-link-dialog" role="dialog" aria-modal="true" aria-label="Choose folder">
        <div id="wrc-link-head">
          <span>Choose Folder</span>
          <button type="button" id="wrc-link-x">×</button>
        </div>
        <div id="wrc-link-tools">
          <input id="wrc-folder-search" type="search" placeholder="Search folder path…" autocomplete="off">
          <span id="wrc-link-count"></span>
        </div>
        <div id="wrc-folder-results"></div>
        <div id="wrc-link-foot">
          <button class="wrc-btn wrc-btn-grey" type="button" id="wrc-link-cancel">Close</button>
        </div>
      </div>
    `;

    const search = modal.querySelector('#wrc-folder-search');
    const count = modal.querySelector('#wrc-link-count');
    const results = modal.querySelector('#wrc-folder-results');

    const render = () => {
      const terms = search.value.toLowerCase().split(/\s+/).filter(Boolean);
      const matches = folders
        .filter(f => terms.every(t => f.path.toLowerCase().includes(t)))
        .slice(0, 120);
      results.innerHTML = '';
      count.textContent = `${matches.length}/${folders.length} shown`;
      for (const folder of matches) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'wrc-folder-choice';
        btn.innerHTML = `<strong>${esc(folder.path)}</strong>${folder.id ? `<small>ID ${esc(folder.id)}</small>` : ''}`;
        btn.addEventListener('click', () => {
          selectedBulkFolder = { folder: folder.path, folderId: folder.id || '' };
          elBulkFolderName.textContent = folder.path;
          elBulkFolderName.title = folder.path;
          if (elBulkStatus) {
            elBulkStatus.className = 'ok';
            elBulkStatus.textContent = `Selected folder: ${folder.path}`;
          }
          closeLinkChooser();
          log(`Bulk edit folder selected: ${folder.path}`, 'ok');
        });
        results.appendChild(btn);
      }
    };

    modal.querySelector('#wrc-link-x').addEventListener('click', closeLinkChooser);
    modal.querySelector('#wrc-link-cancel').addEventListener('click', closeLinkChooser);
    modal.addEventListener('click', e => {
      if (e.target === modal) closeLinkChooser();
    });
    search.addEventListener('input', render);
    search.addEventListener('keydown', e => {
      if (e.key !== 'Enter') return;
      const first = results.querySelector('.wrc-folder-choice');
      if (first) first.click();
    });

    document.body.appendChild(modal);
    render();
    search.focus();
  }

  function openBulkEditChooser(rows, folder) {
    closeLinkChooser();

    const modal = document.createElement('div');
    modal.id = 'wrc-link-modal';
    modal.innerHTML = `
      <div id="wrc-link-dialog" role="dialog" aria-modal="true" aria-label="Choose documents for bulk edit">
        <div id="wrc-link-head">
          <span>Add Folder to Visible Documents</span>
          <button type="button" id="wrc-link-x">×</button>
        </div>
        <div id="wrc-link-tools">
          <button class="wrc-btn wrc-btn-grey" type="button" id="wrc-link-all">Select All</button>
          <button class="wrc-btn wrc-btn-grey" type="button" id="wrc-link-none">Select None</button>
          <span id="wrc-link-count"></span>
        </div>
        <div style="padding:0 14px 8px;font-size:12px;color:#555">
          Target folder: <strong>${esc(folder.folder)}</strong>
        </div>
        <div id="wrc-link-list"></div>
        <div id="wrc-link-foot">
          <button class="wrc-btn wrc-btn-grey" type="button" id="wrc-link-cancel">Close</button>
          <button class="wrc-btn wrc-btn-success" type="button" id="wrc-link-copy">Add Folder to Selected</button>
        </div>
      </div>
    `;

    const list = modal.querySelector('#wrc-link-list');
    rows.forEach((row, i) => {
      const div = document.createElement('label');
      div.className = 'wrc-link-choice';
      div.innerHTML = `
        <input class="wrc-link-check" type="checkbox" checked data-index="${i}">
        <span>
          <span class="wrc-link-title">${esc(row.title)}</span>
          <span class="wrc-link-url">Metadata ID: ${esc(row.metadataId || 'unknown')}</span>
        </span>
      `;
      list.appendChild(div);
    });

    const update = () => {
      const selected = selectedVisibleDocuments(modal, rows).length;
      const count = modal.querySelector('#wrc-link-count');
      if (count) count.textContent = `${selected}/${rows.length} selected`;
    };

    modal.querySelector('#wrc-link-x').addEventListener('click', closeLinkChooser);
    modal.querySelector('#wrc-link-cancel').addEventListener('click', closeLinkChooser);
    modal.addEventListener('click', e => {
      if (e.target === modal) closeLinkChooser();
    });
    modal.querySelector('#wrc-link-all').addEventListener('click', () => {
      modal.querySelectorAll('.wrc-link-check').forEach(cb => { cb.checked = true; });
      update();
    });
    modal.querySelector('#wrc-link-none').addEventListener('click', () => {
      modal.querySelectorAll('.wrc-link-check').forEach(cb => { cb.checked = false; });
      update();
    });
    modal.querySelectorAll('.wrc-link-check').forEach(cb => cb.addEventListener('change', update));
    modal.querySelector('#wrc-link-copy').addEventListener('click', () => {
      const selected = selectedVisibleDocuments(modal, rows);
      if (!selected.length) {
        log('No documents selected for bulk edit', 'warn');
        return;
      }
      closeLinkChooser();
      runBulkFolderAdd(selected, folder);
    });

    document.body.appendChild(modal);
    update();
  }

  btnBulkFolder.addEventListener('click', openBulkFolderChooser);

  btnBulkStop.addEventListener('click', () => {
    if (!bulkEditRunning) return;
    bulkEditStopRequested = true;
    btnBulkStop.disabled = true;
    if (elBulkStatus) {
      elBulkStatus.className = 'err';
      elBulkStatus.textContent = 'Stop requested. Waiting for the current document to finish safely…';
    }
    log('Bulk edit stop requested', 'warn');
  });

  btnBulkAdd.addEventListener('click', () => {
    if (bulkEditRunning) {
      log('Bulk edit is already running', 'warn');
      return;
    }
    const folder = selectedBulkFolder;
    if (!folder || !folder.folder) {
      log('Choose a target folder first.', 'warn');
      openBulkFolderChooser();
      return;
    }

    const rows = collectVisibleDocuments();
    if (!rows.length) {
      log('No visible editable document cards found on this page', 'warn');
      return;
    }
    openBulkEditChooser(rows, folder);
  });

  // ── Select folder via LOV popup (fallback when no folderId known) ─────────
  async function selectFolderViaLOV(formDoc, folderSearch, ifWin) {
    const lovBtn = findFolderLovButton(formDoc);
    if (!lovBtn) { log('Folder LOV button not found – folder skipped', 'warn'); return; }

    _openedPopups = [];
    await openFolderLov(lovBtn, ifWin);

    const lovDoc = await findLovSource(6000);
    if (!lovDoc) { log('LOV popup not found – folder skipped', 'warn'); return; }

    // Type the search term
    const searchBox = lovDoc.querySelector(
      'input[type="search"], input[name="f01"], input[type="text"]'
    );
    if (searchBox) {
      searchBox.value = folderSearch;
      searchBox.dispatchEvent(new InputEvent('input',  { bubbles: true }));
      searchBox.dispatchEvent(new Event('change', { bubbles: true }));
      const goBtn = lovDoc.querySelector('button[type="submit"], input[type="submit"], button');
      if (goBtn) goBtn.click();
      await sleep(800);
    }

    // Click the first matching row — rows are <tr data-id="NNN"> in APEX GV LOV
    const dataRows = Array.from(lovDoc.querySelectorAll('tr[data-id]'));
    let clicked = false;
    for (const tr of dataRows) {
      const cell = tr.querySelector('td');
      if (cell && cell.textContent.trim().toLowerCase().includes(folderSearch.toLowerCase())) {
        tr.click(); clicked = true; break;
      }
    }
    if (!clicked && dataRows.length) {
      dataRows[0].click();
      const label = dataRows[0].querySelector('td')?.textContent.trim() || '?';
      log(`Exact folder match not found – used: "${label}"`, 'warn');
    } else if (!clicked) {
      log(`No folder results for "${folderSearch}"`, 'err');
    }

    // Close any popup windows that opened
    for (const w of _openedPopups) {
      try { if (!w.closed) w.close(); } catch (_) {}
    }
    _openedPopups = [];

    await sleep(400);
  }

  async function waitForFileWidgetReady(doc, filename, timeoutMs = 15000) {
    const deadline = Date.now() + timeoutMs;
    const lowerName = String(filename || '').toLowerCase();
    const ifWin = doc.defaultView;

    while (Date.now() < deadline) {
      const bodyText = (doc.body && doc.body.textContent || '').replace(/\s+/g, ' ').toLowerCase();
      const hasName = !lowerName || bodyText.includes(lowerName);
      const busy = doc.querySelector(
        '.u-Processing, .a-Processing, .apex_wait_overlay, ' +
        '[aria-busy="true"], .is-loading, .is-processing'
      );
      const removeBtn = Array.from(doc.querySelectorAll('button, input[type="button"]'))
        .some(el => /^remove$/i.test((el.textContent || el.value || '').trim()));
      let apexFileValue = '';
      try {
        if (ifWin && ifWin.apex && ifWin.apex.item) {
          apexFileValue = String(ifWin.apex.item('P5_FILE').getValue() || '');
        }
      } catch (_) {}

      if (hasName && !busy && removeBtn && apexFileValue) return true;
      await sleep(300);
    }
    return false;
  }

  function describeFileWidget(doc) {
    const ifWin = doc.defaultView;
    const fileInput = doc.getElementById('P5_FILE_input');
    const hidden = Array.from(doc.querySelectorAll('input[type="hidden"]'))
      .filter(el => /P5_FILE|FILE/i.test(`${el.id || ''} ${el.name || ''}`))
      .map(el => `${el.id || el.name || '(hidden)'}=${String(el.value || '').slice(0, 30) || '(empty)'}`);
    const removeBtn = Array.from(doc.querySelectorAll('button, input[type="button"]'))
      .some(el => /^remove$/i.test((el.textContent || el.value || '').trim()));
    let apexFileValue = '';
    try {
      if (ifWin && ifWin.apex && ifWin.apex.item) {
        apexFileValue = String(ifWin.apex.item('P5_FILE').getValue() || '');
      }
    } catch (_) {}
    return `inputFiles=${fileInput ? fileInput.files.length : 'missing'}, remove=${removeBtn}, apexItem=${apexFileValue || '(empty)'}, hidden=[${hidden.join(', ')}]`;
  }

  function formDataFileState(doc) {
    const input = doc.getElementById('P5_FILE_input');
    const form = input && input.form;
    if (!form) return { ok: false, summary: 'no form' };
    const value = new FormData(form).get('P5_FILE');
    if (!value || typeof value !== 'object') {
      return { ok: false, summary: `P5_FILE is ${value === null ? 'missing' : typeof value}` };
    }
    const name = value.name || '(unnamed)';
    const size = Number(value.size || 0);
    const type = value.type || '(no type)';
    return {
      ok: size > 0,
      summary: `${name} ${size} bytes ${type}`
    };
  }

  function fileDropTargets(doc, input) {
    const targets = [
      input,
      input && input.parentElement,
      input && input.closest('.a-FileDrop, .a-FileDropzone, .apex-item-file, .t-Form-fieldContainer'),
      doc.querySelector('.a-FileDrop, .a-FileDropzone, .apex-item-file, [class*="FileDrop"], [class*="drop"]')
    ].filter(Boolean);
    return Array.from(new Set(targets));
  }

  async function attachFileToApexWidget(doc, ifWin, input, file) {
    const DataTransferCtor = ifWin.DataTransfer || DataTransfer;
    const EventCtor = ifWin.Event || Event;
    const DragEventCtor = ifWin.DragEvent || DragEvent;
    const InputProto = (ifWin.HTMLInputElement && ifWin.HTMLInputElement.prototype) || HTMLInputElement.prototype;

    const dt = new DataTransferCtor();
    dt.items.add(file);

    const filesSetter = Object.getOwnPropertyDescriptor(InputProto, 'files')?.set;
    if (filesSetter) filesSetter.call(input, dt.files);
    else input.files = dt.files;

    const upload = doc.getElementById('P5_FILE');
    try {
      if (upload && 'files' in upload) upload.files = dt.files;
    } catch (_) {}

    const jq = getJq(ifWin);
    const targets = fileDropTargets(doc, input);
    const eventTypes = ['dragenter', 'dragover', 'drop', 'input', 'change'];

    for (const target of targets) {
      for (const type of eventTypes) {
        try {
          const ev = type.startsWith('drag') || type === 'drop'
            ? new DragEventCtor(type, { bubbles: true, cancelable: true, dataTransfer: dt })
            : new EventCtor(type, { bubbles: true, cancelable: true });
          target.dispatchEvent(ev);
        } catch (_) {
          target.dispatchEvent(new EventCtor(type, { bubbles: true, cancelable: true }));
        }

        if (jq) {
          try {
            const jev = jq.Event(type, { bubbles: true, cancelable: true });
            jev.originalEvent = { dataTransfer: dt, target };
            jev.dataTransfer = dt;
            jq(target).trigger(jev);
          } catch (_) {}
        }
      }
      await sleep(150);
    }

    try {
      if (ifWin.apex && ifWin.apex.event) {
        ifWin.apex.event.trigger(input, 'change');
        for (const target of targets) ifWin.apex.event.trigger(target, 'drop');
      }
    } catch (_) {}
  }

  // ── Fill in all form fields ────────────────────────────────────────────────
  async function fillForm(iframe, item, file) {
    const doc = iframe.contentDocument;
    const ifWin = iframe.contentWindow;

    function set(id, value) {
      const el = doc.getElementById(id);
      if (!el) return;
      const nativeSet = Object.getOwnPropertyDescriptor(
        el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype,
        'value'
      )?.set;
      if (nativeSet) nativeSet.call(el, value);
      else el.value = value;
      el.dispatchEvent(new InputEvent('input',  { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    }

    // ── File ──
    if (file) {
      const fi = doc.getElementById('P5_FILE_input');
      if (fi) {
        await attachFileToApexWidget(doc, ifWin, fi, file);
        const ready = await waitForFileWidgetReady(doc, file.name);
        if (ready) log(`File widget ready: ${file.name}`, 'ok');
        else throw new Error(`File widget not ready: ${describeFileWidget(doc)}`);
        const fdState = formDataFileState(doc);
        if (!fdState.ok) throw new Error(`File not present in form data: ${fdState.summary}`);
        log(`FormData file ready: ${fdState.summary}`, 'ok');
        await sleep(2500);
      } else {
        log('File input not found', 'warn');
      }
    }

    // ── Text fields ──
    set('P5_DISPLAY_NAME', item.displayName || '');
    set('P5_DESCRIPTION',  item.description  || '');
    set('P5_VERSION',      item.version      || '');

    // ── Dates (format produced by app: DD-MON-YYYY HH:MI e.g. 01-JAN-2026 09:00) ──
    if (item.startDate) set('P5_PUBLISHED_START_DATE_input', item.startDate);
    if (item.endDate)   set('P5_PUBLISHED_END_DATE_input',   item.endDate);

    // ── Key Document ──
    const cb = doc.getElementById('P5_PRIORITY_YN');
    if (cb) {
      const want = !!item.keyDocument;
      if (cb.checked !== want) jqClick(cb, iframe.contentWindow);
    }

    // ── Folder ──
    // If the desktop app has a folder list imported, it will include folderId.
    // Set both the display field and the hidden value directly – no LOV needed.
    // Falls back to the LOV search if only a folder name is given.
    if (item.folderId) {
      set('P5_TAXONOMY_ID', item.folder || '');
      set('P5_TAXONOMY_ID_HIDDENVALUE', String(item.folderId));
      // Some APEX versions also use P5_ADD_TAXONOMY_ID for the submitted value
      set('P5_ADD_TAXONOMY_ID', String(item.folderId));
      log(`Folder set directly: ${item.folder || item.folderId} (ID ${item.folderId})`, 'ok');
    } else if (item.folder) {
      await selectFolderViaLOV(doc, item.folder, iframe.contentWindow);
    }

    await sleep(300);
  }

  // ── Submit ─────────────────────────────────────────────────────────────────
  async function submitForm(iframe) {
    const doc = iframe.contentDocument;
    const hasFileBytes = formDataFileState(doc).ok;

    for (const el of doc.querySelectorAll('button, input[type="submit"], input[type="button"]')) {
      const txt = (el.textContent || el.value || '').trim().toLowerCase();
      if (txt.includes('add') || txt.includes('save') || txt.includes('upload')) {
        if (hasFileBytes) {
          const form = el.form || doc.getElementById('wwvFlowForm') || doc.querySelector('form');
          if (form) {
            form.enctype = 'multipart/form-data';
            form.encoding = 'multipart/form-data';
            if (typeof form.requestSubmit === 'function' && el.matches('button[type="submit"], input[type="submit"]')) {
              log('Submitting with native multipart requestSubmit', 'info');
              form.requestSubmit(el);
              return;
            }
          }

          log('Submitting with native button click for file upload', 'info');
          el.click();
          return;
        }

        jqClick(el, iframe.contentWindow); return;
      }
    }
    throw new Error('Submit button not found inside form');
  }

  // ── Process one queue item ─────────────────────────────────────────────────
  async function processItem(i) {
    const item = queue[i];
    setStatus(i, 'active');
    elProgressLbl.textContent = `Uploading ${i + 1} of ${queue.length}…`;
    log(`Starting: "${item.displayName || item.file}"`, 'info');

    let file = null;
    if (item.file) {
      try {
        file = await getFile(item.file);
        log(`File: ${file.name} (${(file.size / 1024).toFixed(1)} KB)`, 'ok');
      } catch (e) {
        log(`Cannot read file "${item.file}": ${e.message}`, 'err');
        setStatus(i, 'error', 'file not found'); return false;
      }
    }

    try { await openForm(); }
    catch (e) { log(`Cannot open form: ${e.message}`, 'err'); setStatus(i, 'error', 'form open failed'); return false; }

    let iframe;
    try { iframe = await waitForForm(); log('Form ready', 'ok'); }
    catch (e) { log(`Form timeout: ${e.message}`, 'err'); setStatus(i, 'error', 'form timeout'); return false; }

    // Also intercept window.open on the form iframe for LOV popups
    try {
      const ifWin = iframe.contentWindow;
      const _origIfOpen = ifWin.open.bind(ifWin);
      ifWin.open = function (...args) {
        const w = _origIfOpen(...args);
        if (w) _openedPopups.push(w);
        return w;
      };
    } catch (_) {}

    try { await fillForm(iframe, item, file); log('Fields filled', 'ok'); }
    catch (e) { log(`Fill error: ${e.message}`, 'err'); setStatus(i, 'error', 'fill failed'); return false; }

    try { await submitForm(iframe); log('Submitted – waiting for confirmation…', 'info'); }
    catch (e) { log(`Submit error: ${e.message}`, 'err'); setStatus(i, 'error', 'submit failed'); return false; }

    try {
      const completion = await waitForClose(iframe);
      log(`Primary upload done: "${item.displayName || item.file}" (${completion})`, 'ok');
      if (Array.isArray(item.additionalFolders) && item.additionalFolders.length) {
        try {
          await applyAdditionalFolders(item);
        } catch (e) {
          log(`Extra folder error: ${e.message}`, 'err');
          setStatus(i, 'error', 'extra folders failed'); return false;
        }
      }
      log(`Done: "${item.displayName || item.file}"`, 'ok');
      setStatus(i, 'done'); return true;
    } catch (e) {
      log(`Completion not detected: ${e.message}`, 'warn');
      setStatus(i, 'error', 'no close signal'); return false;
    }
  }

  // ── Queue runner ───────────────────────────────────────────────────────────
  async function runQueue() {
    running = true;
    btnStart.disabled = true;
    btnPause.disabled = false;
    btnStop.disabled  = false;

    for (let i = currentIndex; i < queue.length; i++) {
      if (!running) break;
      while (paused && running) await sleep(500);
      if (!running) break;

      currentIndex = i;
      saveState();
      _openedPopups = [];

      await processItem(i);

      if (running && i < queue.length - 1) {
        const ms   = randomDelay();
        const secs = Math.round(ms / 1000);
        log(`Waiting ${secs}s before next upload…`, 'info');
        for (let s = secs; s > 0 && running && !paused; s--) {
          elProgressLbl.textContent = `Next upload in ${s}s… (${i + 1}/${queue.length} done)`;
          await sleep(1000);
        }
      }
    }

    if (running) {
      const done = queue.filter((_, i) =>
        document.getElementById(`wrc-item-${i}`)?.classList.contains('wrc-done')
      ).length;
      elProgressLbl.textContent = `Complete! ${done}/${queue.length} uploaded.`;
      log(`Queue finished. ${done}/${queue.length} succeeded.`, 'ok');
      clearState();
    }

    running = false; paused = false;
    btnStart.disabled = false;
    btnPause.disabled = true;
    btnStop.disabled  = true;
    btnPause.textContent = 'Pause';
  }

  // ── Button wiring ──────────────────────────────────────────────────────────
  btnStart.addEventListener('click', () => {
    if (!queue.length) { log('Load a queue first', 'warn'); return; }
    paused = false; runQueue();
  });
  btnPause.addEventListener('click', () => {
    paused = !paused;
    btnPause.textContent = paused ? 'Resume' : 'Pause';
    log(paused ? 'Paused' : 'Resumed', 'info');
  });
  btnStop.addEventListener('click', () => {
    running = false; paused = false;
    btnPause.textContent = 'Pause';
    btnStart.disabled = false;
    btnPause.disabled = true;
    btnStop.disabled  = true;
    elProgressLbl.textContent = 'Stopped by user.';
    log('Stopped', 'warn');
  });
  $('wrc-btn-reset').addEventListener('click', () => {
    running = false; paused = false;
    queue = []; currentIndex = 0;
    clearState();
    elItemList.innerHTML = '';
    elProgress.style.display = 'none';
    elLog.innerHTML = '';
    $('wrc-queue-ta').value = '';
    btnStart.disabled = true;
    btnPause.disabled = true;
    btnStop.disabled  = true;
    btnPause.textContent  = 'Pause';
    elQueueStatus.className = '';
    elQueueStatus.textContent = 'No queue loaded.';
    elFolderStatus.className = '';
    elFolderStatus.textContent = 'No folder selected.';
    elScanStatus.className = '';
    elScanStatus.textContent = 'Not scanned yet.';
    lastScannedFolders = null;
    btnCopyFolders.disabled = true;
    elProgressLbl.textContent = 'Ready';
    dirHandle = null;
    _openedPopups = [];
  });

  // ── Restore state ──────────────────────────────────────────────────────────
  if (queue.length > 0) {
    buildItemList();
    btnStart.disabled = false;
    const remaining = queue.length - currentIndex;
    elQueueStatus.className = 'ok';
    elQueueStatus.textContent = `${queue.length} item(s) – restored (${remaining} remaining)`;
    log(`Queue restored. ${remaining} item(s) left from index ${currentIndex}.`, 'warn');
  }

  // ── "Clean name" helper button for manual (non-bulk) Add/Edit Document use ─
  // Keeps original wording/casing – only strips the extension and turns
  // underscores/dots into spaces, since guessing at capitalisation rules
  // would risk getting it wrong on real document titles.
  function cleanFileNameForDisplay(name) {
    const base = String(name || '').replace(/\.[^./\\]+$/, '');
    return base.replace(/[_.]+/g, ' ').replace(/\s+/g, ' ').trim();
  }

  function currentUploadedFileName(doc) {
    const input = doc.getElementById('P5_FILE_input');
    if (input && input.files && input.files.length) return input.files[0].name;
    try {
      const ifWin = doc.defaultView;
      if (ifWin && ifWin.apex && ifWin.apex.item) {
        const v = ifWin.apex.item('P5_FILE').getValue();
        if (v) return String(v);
      }
    } catch (_) {}
    return '';
  }

  function injectCleanNameButton(doc, ifWin) {
    const nameField = doc.getElementById('P5_DISPLAY_NAME');
    if (!nameField || doc.getElementById('wrc-clean-name-btn')) return;

    // Anchor to the input's own immediate wrapper and position the button
    // absolutely against it. The form's grid/flex layout kept re-fighting
    // an in-flow button (v4.15 pushed it off to the side, v4.16 let it
    // collapse/overlap the input) — taking it out of flow entirely sidesteps
    // that for good.
    const anchor = nameField.parentElement || nameField;
    if (getComputedStyle(anchor).position === 'static') {
      anchor.style.position = 'relative';
    }

    const btn = doc.createElement('button');
    btn.type = 'button';
    btn.id = 'wrc-clean-name-btn';
    btn.textContent = '🧹 From filename';
    btn.title = 'Fill Display Name from the uploaded file (strips extension, underscores and dots)';
    btn.style.cssText =
      'position:absolute;left:100%;top:50%;transform:translateY(-50%);' +
      'margin-left:8px;padding:3px 9px;font-size:11px;font-weight:600;white-space:nowrap;' +
      'border:1px solid #0572ce;border-radius:4px;background:#eaf4ff;color:#0572ce;' +
      'cursor:pointer;z-index:5;';

    btn.addEventListener('click', e => {
      e.preventDefault();
      const orig = btn.textContent;
      const raw = currentUploadedFileName(doc);
      if (!raw) {
        btn.textContent = 'No file yet';
        setTimeout(() => { btn.textContent = orig; }, 1500);
        return;
      }
      setItemValue(doc, ifWin, 'P5_DISPLAY_NAME', cleanFileNameForDisplay(raw));
      btn.textContent = '✓ Filled';
      setTimeout(() => { btn.textContent = orig; }, 1500);
    });

    anchor.appendChild(btn);
  }

  function startCleanNameButtonWatcher() {
    setInterval(() => {
      const iframe = findIframe();
      if (!iframe) return;
      let doc;
      try { doc = iframe.contentDocument; } catch (_) { return; }
      if (doc) injectCleanNameButton(doc, iframe.contentWindow);
    }, 700);
  }
  startCleanNameButtonWatcher();

})();
