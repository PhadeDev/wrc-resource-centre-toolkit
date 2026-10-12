// ==UserScript==
// @name         Westminster RC – Resource Center Toolkit
// @namespace    https://westminster.cadetnet.mod.uk/
// @version      4.32
// @description  Resource Centre upload, folder, link, bulk edit, and mapped bulk download tools.
// @match        https://westminster.cadetnet.mod.uk/app/r/westminster/resource_centre/home*
// @match        https://www.westminster.cadetnet.mod.uk/app/r/westminster/resource_centre/home*
// @match        https://westminster.cadetnet.mod.uk/app/r/westminster/resource_centre/manage-documents*
// @match        https://www.westminster.cadetnet.mod.uk/app/r/westminster/resource_centre/manage-documents*
// @grant        none
// @run-at       document-idle
// @updateURL    https://raw.githubusercontent.com/PhadeDev/wrc-resource-centre-toolkit/main/wrc-bulk-uploader.user.js
// @downloadURL  https://raw.githubusercontent.com/PhadeDev/wrc-resource-centre-toolkit/main/wrc-bulk-uploader.user.js
// ==/UserScript==

(function () {
  'use strict';

  // Manage Documents uses a dedicated view; upload helpers never start here.
  if (/\/manage-documents\/?$/i.test(location.pathname)) {
    startDownloadView();
    return;
  }

  function startDownloadView() {
    let destination = null;
    let busy = false;
    let stopped = false;
    const controllers = new Set();
    let runReason = '';
    const events = [];
    let runId = null;
    let metadata = null;
    let folderSelection = null;
    const expandedFolders = new Set();
    let manifest = null;
    let view = 'all';
    const results = [];
    const panel = document.createElement('section');
    panel.id = 'wrc-download-panel';
    panel.style.cssText = 'position:fixed;bottom:24px;right:24px;width:380px;max-width:calc(100vw - 32px);max-height:80vh;overflow:auto;z-index:2147483646;background:white;color:#222;border:2px solid #0572ce;border-radius:8px;box-shadow:0 6px 24px #0003;font:13px Segoe UI,sans-serif;padding:12px;box-sizing:border-box';
    panel.style.width = '460px';
    const style = document.createElement('style');
    style.textContent = '#wrc-download-panel{border:1px solid #d6dce6!important;padding:0!important;border-radius:14px!important;box-shadow:0 12px 45px #182b4930!important}#wrc-download-panel strong{font-size:14px}#wrc-download-panel>div:first-child{padding:14px 18px;background:#f3f6fb;border-bottom:1px solid #e0e5ed}#wrc-dl-body{padding:0 18px 16px}#wrc-download-panel p{line-height:1.5;color:#536175}#wrc-download-panel button{padding:7px 10px;border:1px solid #ccd5e2;border-radius:7px;background:#f8fafc;color:#253751;cursor:pointer}#wrc-download-panel button:disabled{opacity:.45;cursor:default}#wrc-dl-start{background:#165bd4!important;color:white!important;border-color:#165bd4!important}#wrc-download-panel input,#wrc-download-panel select{box-sizing:border-box;padding:6px;border:1px solid #cbd5e1;border-radius:6px;max-width:100%}#wrc-dl-status{background:#edf3ff;padding:10px;border-radius:8px;color:#214776!important}#wrc-dl-log{border:1px solid #e1e7ef;border-radius:8px;padding:8px;overflow-wrap:anywhere;white-space:pre-wrap}#wrc-dl-log>div{padding:6px 0;border-bottom:1px solid #edf0f5}';
    document.body.appendChild(style);
    panel.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center"><strong>Resource Centre Toolkit v4.32</strong><button type="button" id="wrc-dl-min" aria-label="Minimise downloads">−</button></div>
      <div id="wrc-dl-body">
        <h3 style="margin:12px 0 6px">Bulk download</h3>
        <p>Downloads files currently displayed in Manage Documents. Apply your filters and increase rows per page first. Other pages are not included.</p>
        <p>Resume skips non-empty completed copies. Missing and empty files are retried. Original filenames and folder assignments are preserved.</p>
        <label>Optional folder mapping CSV: <input id="wrc-dl-metadata" type="file" accept=".csv,text/csv"></label>
        <p>Resource Centre folders:<br><button type="button" id="wrc-dl-tree" disabled style="width:100%;text-align:left">No mapping loaded (flat download)</button></p>
        <fieldset id="wrc-dl-picker" hidden style="border:1px solid #dbe3ee;border-radius:10px;margin:0 0 12px;padding:10px">
          <legend>Choose folders</legend>
          <input id="wrc-dl-search" type="search" placeholder="Search folder names or paths" aria-label="Search Resource Centre folders" style="width:100%">
          <div style="display:flex;gap:6px;margin:8px 0"><button type="button" id="wrc-dl-all">Select all</button><button type="button" id="wrc-dl-none">Clear all</button><button type="button" id="wrc-dl-picker-done">Done</button></div>
          <div id="wrc-dl-folder-list" role="group" aria-label="Folder tree" style="max-height:260px;overflow:auto"></div>
          <p id="wrc-dl-selection" role="status" style="margin:8px 0 0"></p>
        </fieldset>
        <button type="button" id="wrc-dl-preview">Scan / preview</button>
        <p>Select a parent to include its subfolders, then untick branches to exclude them. Search only changes what you see. Scan / preview shows the final paths under your download folder. Only displayed documents are included.</p>
        <button type="button" id="wrc-dl-folder">Choose download folder</button>
        <p id="wrc-dl-destination">No folder selected.</p>
        <p><label>Concurrent downloads: <input id="wrc-dl-concurrency" type="number" min="1" max="8" step="1" value="1" style="width:55px"></label></p>
        <label>Gap between starts (seconds): <input id="wrc-dl-delay" type="number" min="0" max="60" step="0.1" value="1" style="width:55px"></label>
        <p>Speed settings apply during a run. Lowering concurrency lets current files finish. Blocking responses stop all requests; no automatic retries.</p>
        <div style="display:flex;gap:8px;margin-top:12px"><button type="button" id="wrc-dl-start">Download displayed files</button><button type="button" id="wrc-dl-stop" disabled>Stop</button></div>
        <p id="wrc-dl-status" role="status" aria-live="polite">Ready.</p>
        <button type="button" id="wrc-dl-export">Export download log</button>
        <button type="button" id="wrc-dl-copy-errors">Copy errors</button><button type="button" id="wrc-dl-copy-log">Copy full log</button>
        <button type="button" id="wrc-dl-recovery-status">Check recovery status</button>
        <p><label>Results: <select id="wrc-dl-results"><option value="all">All</option><option value="failed">Failed</option><option value="successful">Successful</option><option value="skipped">Skipped</option><option value="recovery">Recovery staged</option></select></label></p>
        <p id="wrc-dl-counts">No run results yet.</p>
        <div id="wrc-dl-log" style="max-height:140px;overflow:auto;font-size:12px;white-space:pre-wrap"></div>
      </div>`;
    document.body.appendChild(panel);
    const get = id => panel.querySelector('#wrc-dl-' + id);
    const status = message => { get('status').textContent = message; };
    const category = message => /FAILED|file_failed|run_halted/i.test(message) ? 'failed' : /recovery_staged|file_staged/i.test(message) ? 'recovery' : /Saved:|copy_saved|copy_recovered|file_completed/i.test(message) ? 'successful' : /SKIPPED|skipped/i.test(message) ? 'skipped' : 'all';
    const log = (message, kindOverride = null) => {
      const row = document.createElement('div');
      row.textContent = message;
      const kind = kindOverride || category(message);
      row.hidden = view !== 'all' && kind !== view;
      results.push({ message, kind, row });
      get('log').appendChild(row);
      get('log').scrollTop = get('log').scrollHeight;
      const counts = kind => results.filter(item => item.kind === kind).length;
      get('counts').textContent = `Errors ${counts('failed')} · Saved events ${counts('successful')} · Skips ${counts('skipped')} · Recovery ${counts('recovery')}`;
    };
    get('results').onchange = () => { view = get('results').value; for (const item of results) item.row.hidden = view !== 'all' && item.kind !== view; };
    const copy = async text => {
      try { await navigator.clipboard.writeText(text); status('Copied to clipboard.'); }
      catch (_) {
        const area = document.createElement('textarea'); area.value = text; area.style.cssText = 'position:fixed;left:-9999px'; document.body.appendChild(area); area.select();
        const copied = document.execCommand('copy'); area.remove(); status(copied ? 'Copied to clipboard.' : 'Clipboard unavailable. Use Export download log.');
      }
    };
    get('copy-errors').onclick = () => copy(results.filter(item => item.kind === 'failed').map(item => item.message).join('\n') || 'No errors in the current results.');
    get('copy-log').onclick = () => copy(events.map(event => JSON.stringify(event)).join('\n'));
    get('recovery-status').onclick = async () => {
      if (!destination) { status('Choose the download root first.'); return; }
      try {
        const stage = await destination.getDirectoryHandle('.wrc-recovery');
        const handle = await stage.getFileHandle('recovery-results.json');
        const report = JSON.parse(await (await handle.getFile()).text());
        let recovered = 0, failures = 0;
        for (const item of report.results || []) {
          if (item.status === 'failed') { failures++; record('file_failed', { id: item.id, name: item.relativePath, phase: 'native_recovery', error: downloadLogError(new Error(item.error)) }); }
          else { recovered++; record('copy_recovered', { id: item.id, destination: item.relativePath, message: 'Local helper reports destination verified.' }); }
        }
        status(`Local helper reports ${recovered} copies verified and ${failures} failures. Existing saved files are preserved.`);
      } catch (error) { status('Recovery report not available yet: ' + error.message); }
    };
    const record = (event, details = {}) => {
      const entry = { time: new Date().toISOString(), runId, event, ...details };
      events.push(entry);
      const kind = ['file_failed', 'run_halted'].includes(event) ? 'failed' : ['recovery_staged', 'file_staged'].includes(event) ? 'recovery' : ['copy_saved', 'copy_recovered', 'file_completed'].includes(event) ? 'successful' : ['row_skipped', 'copy_skipped', 'file_skipped'].includes(event) ? 'skipped' : 'all';
      const description = event === 'file_failed' ? `${details.name || 'Download'} [ID ${details.id || '-'}] - ${details.phase || 'unknown stage'}: ${details.error}; HTTP ${details.httpStatus || '-'}; Retry-After ${details.retryAfter || '-'}` : JSON.stringify(details);
      log(`${entry.time} ${event}: ${description}`, kind);
    };
    const settings = () => readDownloadSpeed(get('concurrency').value, get('delay').value);
    try {
      const saved = JSON.parse(localStorage.getItem('wrc_download_speed') || 'null');
      if (saved) { const valid = readDownloadSpeed(saved.concurrency, saved.delay); get('concurrency').value = valid.concurrency; get('delay').value = valid.delay; }
    } catch (_) { /* Unavailable or invalid storage leaves conservative defaults. */ }
    for (const id of ['concurrency', 'delay']) get(id).onchange = () => {
      try {
        const speed = settings();
        try { localStorage.setItem('wrc_download_speed', JSON.stringify(speed)); } catch (_) {}
        record('speed_changed', speed);
      } catch (error) { status(error.message); }
    };
    get('export').onclick = () => {
      const blob = new Blob([events.map(event => JSON.stringify(event)).join('\n') + '\n'], { type: 'application/x-ndjson' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url; link.download = 'wrc-download-log-' + new Date().toISOString().replace(/[:.]/g, '-') + '.jsonl';
      link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
    };
    get('min').onclick = () => { get('body').hidden = !get('body').hidden; };
    const renderFolders = (focusPath = null, focusType = 'check') => {
      get('folder-list').replaceChildren();
      if (!metadata || !folderSelection) return;
      const query = get('search').value.trim().toLowerCase();
      const states = downloadFolderStates(metadata.folders, folderSelection);
      const matches = new Set(metadata.folders.filter(path => path.toLowerCase().includes(query)));
      const visible = new Set(matches);
      for (const path of matches) {
        const parts = path.split(' > ');
        for (let n = 1; n < parts.length; n++) visible.add(parts.slice(0, n).join(' > '));
      }
      const containers = new Map([['', get('folder-list')]]);
      let focusControl = null;
      for (const path of metadata.folders) {
        if (!visible.has(path)) continue;
        const parts = path.split(' > '), parent = parts.slice(0, -1).join(' > ');
        if (!query && parent && !expandedFolders.has(parent)) continue;
        const row = document.createElement('div');
        row.style.cssText = 'padding:4px 0;display:flex;align-items:center;gap:5px;min-width:0';
        const hasChildren = states.get(path).children > 0;
        const expand = document.createElement('button');
        expand.type = 'button'; expand.textContent = hasChildren ? (query || expandedFolders.has(path) ? '▾' : '▸') : '·';
        expand.style.cssText = 'padding:0;width:22px;flex:none;border:0;background:transparent';
        expand.disabled = !hasChildren || !!query;
        expand.setAttribute('aria-label', 'Expand or collapse ' + parts.at(-1));
        expand.setAttribute('aria-expanded', String(!!query || expandedFolders.has(path)));
        expand.onclick = () => { expandedFolders.has(path) ? expandedFolders.delete(path) : expandedFolders.add(path); renderFolders(path, 'expand'); };
        const label = document.createElement('label');
        label.style.cssText = 'display:flex;align-items:center;gap:6px;overflow-wrap:anywhere;cursor:pointer';
        const check = document.createElement('input'); check.type = 'checkbox';
        check.checked = states.get(path).checked; check.indeterminate = states.get(path).mixed;
        check.onchange = () => { setDownloadFolderSelection(folderSelection, path, check.checked); renderFolders(path); };
        if (path === focusPath) focusControl = focusType === 'expand' ? expand : check;
        const name = document.createElement('span'); name.textContent = parts.at(-1); name.title = path;
        label.appendChild(check); label.appendChild(name); row.appendChild(expand); row.appendChild(label);
        const container = containers.get(parent);
        if (!container) continue;
        container.appendChild(row);
        const children = document.createElement('div'); children.style.marginLeft = '16px';
        container.appendChild(children); containers.set(path, children);
      }
      const count = metadata.folders.filter(path => downloadFolderSelected(path, folderSelection)).length;
      get('tree').textContent = count ? `${count} folders selected · Browse / change` : 'No folders selected · Browse / change';
      get('selection').textContent = `${count} of ${metadata.folders.length} folders selected. ${query ? matches.size + ' search matches. ' : ''}Selections apply immediately; use Scan / preview to check files.`;
      if (query && !matches.size) get('folder-list').textContent = 'No matching folders.';
      focusControl?.focus?.({ preventScroll: true });
    };
    get('tree').onclick = () => { get('picker').hidden = !get('picker').hidden; };
    get('picker-done').onclick = () => { get('picker').hidden = true; };
    get('search').value = '';
    get('search').oninput = renderFolders;
    get('all').onclick = () => { folderSelection.rules.clear(); for (const path of metadata.folders.filter(path => !path.includes(' > '))) folderSelection.rules.set(path, true); renderFolders(); };
    get('none').onclick = () => { folderSelection.rules.clear(); renderFolders(); };
    get('metadata').onchange = async () => {
      metadata = null;
      folderSelection = null;
      expandedFolders.clear();
      get('folder-list').replaceChildren(); get('picker').hidden = true; get('search').value = '';
      get('tree').textContent = 'No mapping loaded (flat download)';
      get('tree').disabled = true;
      const file = get('metadata').files?.[0];
      if (!file) { status('No mapping loaded. Downloads will use the flat folder.'); return; }
      try {
        metadata = parseDownloadMetadata(await file.text());
        const initial = metadata.folders.find(path => path.endsWith(' > Army Cadet Syllabus 21 (ACS21)')) || metadata.folders[0];
        folderSelection = { rules: new Map([[initial, true]]) };
        const parts = initial.split(' > ');
        for (let n = 1; n <= parts.length; n++) expandedFolders.add(parts.slice(0, n).join(' > '));
        renderFolders();
        get('tree').disabled = false;
        status(`Loaded ${metadata.records.size} document IDs. Choose a folder, then Scan / preview.`);
      } catch (error) { metadata = null; status('Mapping could not be loaded: ' + error.message); }
    };
    const scan = () => {
      if (get('metadata').files?.length && !metadata) throw new Error('Load a valid metadata CSV before downloading, or clear the file selection for a flat download.');
      const skipped = [];
      const displayed = collectDisplayedDownloads(document, file => skipped.push(file));
      const plan = planMappedDownloads(displayed, metadata, folderSelection);
      return { ...plan, skipped };
    };
    get('preview').onclick = () => {
      try {
        const plan = scan();
        get('log').replaceChildren();
        results.length = 0;
        for (const file of plan.files) log(`${file.name} [ID ${file.id}] -> ${file.paths.map(p => p.join('/') || '[chosen folder]').join('; ')}`);
        status(`${plan.matched} matching displayed records; ${plan.files.length} files to fetch; ${plan.copies} folder copies; ${plan.missing} mapped IDs not eligible/displayed; ${plan.skipped.length} zero-entry rows. Nothing downloaded.`);
      } catch (error) { status(error.message); }
    };
    get('folder').disabled = get('start').disabled = true;
    rememberDownloadFolder().then(saved => {
      if (saved?.kind === 'directory') {
        destination = saved;
        get('destination').textContent = 'Remembered folder: ' + saved.name;
        status('Last download folder restored. Click Download to approve access if the browser asks.');
      }
    }).catch(() => { status('Folder memory unavailable. Choose a download folder for this session.'); })
      .finally(() => { get('folder').disabled = get('start').disabled = false; });
    get('folder').onclick = async () => {
      if (!window.showDirectoryPicker) {
        status('Folder saving is unavailable in this browser. Use Chrome or Edge.');
        return;
      }
      try {
        destination = await window.showDirectoryPicker({ mode: 'readwrite' });
        get('destination').textContent = 'Folder: ' + destination.name;
        try { await rememberDownloadFolder(destination); }
        catch (_) { status('Folder selected, but could not remember it for the next refresh.'); }
      } catch (error) {
        if (error.name !== 'AbortError') status('Folder selection failed: ' + error.message);
      }
    };
    get('stop').onclick = () => {
      stopped = true;
      runReason = 'user_stop';
      for (const controller of controllers) controller.abort();
      record('stop_requested', { active: controllers.size });
      status('Stopping. Any file already being saved will finish.');
    };
    get('start').onclick = async () => {
      if (busy) return;
      if (!destination) { status('Choose a download folder first.'); return; }
      // Permission requests need this explicit user click after a refresh.
      if (destination.queryPermission) {
        try {
          let permission = await destination.queryPermission({ mode: 'readwrite' });
          if (permission !== 'granted') permission = await destination.requestPermission({ mode: 'readwrite' });
          if (permission !== 'granted') { status('Folder access was not granted. Allow access or choose another folder.'); return; }
        } catch (error) { status('Cannot access the remembered folder. Choose it again: ' + error.message); return; }
      }
      let files;
      const skipped = [];
      get('log').replaceChildren();
      results.length = 0;
      try { manifest = await openDownloadManifest(destination); }
      catch (error) { status('Cannot open resume manifest: ' + error.message); return; }
      let plan;
      try { plan = scan(); files = plan.files; skipped.push(...plan.skipped); }
      catch (error) { status(error.message); return; }
      runId = new Date().toISOString() + '-' + events.length;
      for (const file of skipped) record('row_skipped', { id: file.id, name: file.name, reason: 'zero Folder Entries' });
      log(`Scan: ${plan.matched} matching displayed records; ${files.length} files; ${plan.copies} folder copies; ${plan.missing} mapped IDs not eligible/displayed.`);
      if (!files.length) { status(`No eligible download links found. ${skipped.length} skipped.`); return; }
      let speed;
      try { speed = settings(); } catch (error) { status(error.message); return; }
      busy = true;
      stopped = false;
      runReason = '';
      for (const id of ['start', 'folder', 'metadata', 'tree', 'picker', 'preview']) get(id).disabled = true;
      get('stop').disabled = false;
      let done = 0, failed = 0, attempted = 0, staged = 0, savedCopies = 0, consecutiveFailures = 0, downloadedBytes = 0;
      const totalFiles = files.length;
      const startedAt = Date.now();
      record('run_started', { version: '4.31', files: files.length, matched: plan.matched, copies: plan.copies, missing: plan.missing, zeroEntryRows: plan.skipped.length, ...speed });
      try {
        const pending = [];
        for (let i = 0; i < files.length && !stopped; i++) {
          const file = files[i];
          status(`Checking saved copies ${i + 1}/${totalFiles}. No download requests yet.`);
          try {
            file.targets = await pendingDownloadTargets(destination, file, message => record('copy_skipped', { id: file.id, name: file.name, destination: message.replace(/^SKIPPED: /, '') }), manifest);
            if (file.targets.length) pending.push(file);
            else { skipped.push(file); attempted++; record('file_skipped', { id: file.id, name: file.name, reason: 'all copies already present' }); }
          } catch (error) { failed++; attempted++; record('file_failed', { id: file.id, name: file.name, phase: 'resume_check', error: downloadLogError(error) }); }
          if (i % 25 === 0) await new Promise(resolve => setTimeout(resolve, 0));
        }
        files = pending;
        await runDownloadPool(files, settings, async (file, launchSpeed) => {
          const controller = new AbortController();
          controllers.add(controller);
          const timeout = setTimeout(() => controller.abort(), 120000);
          const fileStarted = Date.now();
          let phase = 'destination';
          let needsRepair = false;
          record('file_started', { id: file.id, name: file.name, active: controllers.size, ...launchSpeed });
          try {
            const targets = file.targets;
            if (!targets.length) {
              skipped.push(file);
              record('file_skipped', { id: file.id, name: file.name, reason: 'all copies already exist' });
              return;
            }
            if (stopped) return;
            phase = 'resolve';
            const storageUrl = await resolveDownloadUrl(file.id, controller.signal);
            phase = 'fetch';
            let response;
            try { response = await fetch(storageUrl, { credentials: 'omit', signal: controller.signal }); }
            catch (error) {
              if (error.name === 'AbortError') throw error;
              throw new Error('Storage fetch failed (network or browser cross-origin restriction). Run stopped.');
            }
            if (!response.ok) {
              const error = new Error('HTTP ' + response.status);
              error.httpStatus = response.status;
              error.retryAfter = safeDownloadRetryAfter(response.headers?.get('Retry-After'));
              throw error;
            }
            record('response_received', { id: file.id, name: file.name, httpStatus: response.status || 200, elapsedMs: Date.now() - fileStarted });
            if (response.redirected && /login|signin|sign-in/i.test(response.url)) throw new Error('Session expired. Sign in again.');
            phase = 'body';
            const blob = await response.blob();
            if (stopped) return;
            downloadedBytes += blob.size;
            if (!blob.size) throw new Error('Empty response');
            // APEX authentication/error pages must never be saved as documents.
            if (/text\/html|application\/xhtml/i.test(blob.type) && !/\.html?$/i.test(file.name)) throw new Error('Server returned a web page instead of the file; file may be unavailable.');
            phase = 'save';
            await saveDownloadCopies(targets, file.name, blob, () => stopped, message => {
              if (message.startsWith('Saved: ')) savedCopies++;
              record(message.startsWith('Saved: ') ? 'copy_saved' : 'copy_skipped', { id: file.id, name: file.name, destination: message.replace(/^(Saved|SKIPPED): /, '') });
            }, { root: destination, file, manifest, onStage: label => { staged++; needsRepair = true; record('recovery_staged', { id: file.id, name: file.name, destination: label, message: 'Waiting for local repair helper; not yet saved to final folder.' }); } });
            if (!stopped) { if (!needsRepair) done++; consecutiveFailures = 0; record(needsRepair ? 'file_staged' : 'file_completed', { id: file.id, name: file.name, bytes: blob.size, elapsedMs: Date.now() - fileStarted }); }
          } catch (error) {
            if (stopped) { record('file_cancelled', { id: file.id, name: file.name, phase, reason: runReason }); return; }
            failed++;
            consecutiveFailures++;
            record('file_failed', { id: file.id, name: file.name, phase, error: downloadLogError(error), httpStatus: error.httpStatus || Number(error.message.match(/HTTP (\d+)/)?.[1]) || null, retryAfter: error.retryAfter || null, elapsedMs: Date.now() - fileStarted, ...launchSpeed });
            // Do not continue hammering a throttled or unauthorised session.
            if (/HTTP (401|403|429|503)|Session expired|Storage fetch failed|APEX download helper unavailable/i.test(error.message) || consecutiveFailures >= 3) {
              stopped = true;
              runReason = consecutiveFailures >= 3 ? 'repeated_failures' : 'blocking_response';
              for (const active of controllers) active.abort();
              record('run_halted', { reason: runReason, message: 'Resolve the session or server issue before trying again. No automatic retries.' });
            }
          } finally { attempted++; clearTimeout(timeout); controllers.delete(controller); }
        }, () => stopped, progress => {
          const seconds = Math.max(1, (Date.now() - startedAt) / 1000);
          status(`${attempted}/${totalFiles} processed; ${progress.active} active; ${savedCopies} copies saved; ${failed} failed; ${staged} staged; ${(done * 60 / seconds).toFixed(1)} files/min, ${(downloadedBytes / 1048576 / seconds).toFixed(2)} MiB/s.`);
        }, () => { stopped = true; runReason = 'invalid_speed'; for (const active of controllers) active.abort(); });
      } catch (error) {
        stopped = true; runReason = 'invalid_speed';
        record('run_halted', { reason: runReason, error: downloadLogError(error) });
      } finally {
        if (staged) {
          try {
            const stage = await destination.getDirectoryHandle('.wrc-recovery', { create: true });
            const handle = await stage.getFileHandle('run.ready.json', { create: true });
            const writer = await handle.createWritable();
            try { await writer.write(JSON.stringify({ runId, readyAt: new Date().toISOString() })); await writer.close(); }
            catch (error) { await writer.abort().catch(() => {}); throw error; }
          } catch (error) { record('file_failed', { phase: 'recovery_ready', error: downloadLogError(error) }); }
        }
        busy = false;
        for (const id of ['start', 'folder', 'delay', 'metadata', 'preview']) get(id).disabled = false;
        get('tree').disabled = !metadata;
        get('picker').disabled = false;
        get('stop').disabled = true;
        record('run_finished', { attempted, done, failed, staged, skipped: skipped.length, savedCopies, downloadedBytes, stopped, reason: runReason || 'complete', elapsedMs: Date.now() - startedAt });
        status(`${stopped ? 'Stopped' : 'Finished'}: ${attempted}/${totalFiles} processed; ${savedCopies} copies saved; ${failed} failed; ${skipped.length} files skipped; ${staged} copies staged for local repair. Use Results or Copy errors.`);
      }
    };
  }

  function readDownloadSpeed(concurrency, delay) {
    if (String(concurrency).trim() === '' || String(delay).trim() === '') throw new Error('Enter concurrency 1-8 and a start gap of 0-60 seconds.');
    concurrency = Number(concurrency); delay = Number(delay);
    if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 8 || !Number.isFinite(delay) || delay < 0 || delay > 60) throw new Error('Enter concurrency 1-8 and a start gap of 0-60 seconds.');
    return { concurrency, delay };
  }

  async function runDownloadPool(files, getSpeed, work, isStopped, progress, onError = () => {}) {
    const active = new Set();
    let next = 0, lastStart = -Infinity, failure = null;
    const fail = error => { if (!failure) { failure = error; onError(error); } };
    while (active.size || (next < files.length && !isStopped() && !failure)) {
      if (!isStopped() && !failure && next < files.length) {
        try {
          const speed = getSpeed();
          if (active.size < speed.concurrency && Date.now() - lastStart >= speed.delay * 1000) {
            const file = files[next++]; lastStart = Date.now();
            let task;
            task = Promise.resolve().then(() => work(file, speed)).catch(fail).finally(() => active.delete(task));
            active.add(task);
          }
        } catch (error) { fail(error); }
      }
      progress({ active: active.size, started: next, total: files.length });
      if (active.size || (next < files.length && !isStopped() && !failure)) await new Promise(resolve => setTimeout(resolve, 50));
    }
    if (failure) throw failure;
  }

  function safeDownloadRetryAfter(value) {
    if (!value) return null;
    if (/^\d{1,10}$/.test(value)) return value + ' seconds';
    const date = Date.parse(value);
    return Number.isFinite(date) ? new Date(date).toISOString() : null;
  }

  function downloadLogError(error) {
    if (error.name === 'AbortError') return 'Download timed out';
    return String(error.message || 'Unknown error').replace(/https?:\/\/[^\s]+/gi, '[URL redacted]').replace(/\b(?:session|token|cookie|authorization)\s*[=:]\s*[^\s,;]+/gi, '[credential redacted]').slice(0, 500);
  }

  function parseDownloadCsv(text) {
    text = String(text).replace(/^\uFEFF/, '');
    const rows = []; let row = [], cell = '', quoted = false, closed = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (quoted) {
        if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; }
        else if (c === '"') { quoted = false; closed = true; }
        else cell += c;
      } else if (c === '"') {
        if (cell || closed) throw new Error('Malformed CSV quoting.');
        quoted = true;
      } else if (c === ',' || c === '\n' || c === '\r') {
        row.push(cell); cell = ''; closed = false;
        if (c !== ',') {
          if (row.some(value => value !== '')) rows.push(row);
          row = [];
          if (c === '\r' && text[i + 1] === '\n') i++;
        }
      } else {
        if (closed) throw new Error('Unexpected text after a CSV quote.');
        cell += c;
      }
    }
    if (quoted) throw new Error('Unclosed CSV quote.');
    row.push(cell);
    if (row.some(value => value !== '')) rows.push(row);
    return rows;
  }

  function parseDownloadMetadata(text) {
    const rows = parseDownloadCsv(text);
    const headers = rows.shift()?.map(value => value.trim().toLowerCase()) || [];
    const idIndex = headers.indexOf('select'), pathIndex = headers.indexOf('folder path');
    if (idIndex < 0 || pathIndex < 0) throw new Error('Use the bulk document metadata export with Select and Folder Path columns.');
    const records = new Map(), folders = new Set();
    for (const row of rows) {
      if (row.length !== headers.length) throw new Error('CSV row has an unexpected number of columns.');
      const id = row[idIndex].trim();
      if (!/^\d+$/.test(id)) throw new Error('CSV contains an invalid document ID.');
      const paths = (row[pathIndex] || '').split(':').filter(value => value.trim()).map(value => value.split(' > ').map(part => part.trim()));
      for (const parts of paths) {
        if (parts.some(part => !part)) throw new Error('CSV contains an empty folder name.');
        for (let n = 1; n <= parts.length; n++) folders.add(parts.slice(0, n).join(' > '));
      }
      records.set(id, [...(records.get(id) || []), ...paths]);
    }
    if (!records.size || !folders.size) throw new Error('No document folder mappings found.');
    return { records, folders: Array.from(folders).sort() };
  }

  function downloadFolderSelected(path, selection) {
    let selected = false, depth = -1;
    for (const [rule, included] of selection.rules) {
      if ((path === rule || path.startsWith(rule + ' > ')) && rule.length > depth) { selected = included; depth = rule.length; }
    }
    return selected;
  }

  function setDownloadFolderSelection(selection, path, included) {
    for (const rule of selection.rules.keys()) if (rule === path || rule.startsWith(path + ' > ')) selection.rules.delete(rule);
    selection.rules.set(path, included);
  }

  function downloadFolderStates(folders, selection) {
    const states = new Map(folders.map(path => [path, { total: 1, selected: downloadFolderSelected(path, selection) ? 1 : 0, children: 0 }]));
    for (const path of [...folders].sort((a, b) => b.split(' > ').length - a.split(' > ').length)) {
      const parent = path.split(' > ').slice(0, -1).join(' > ');
      if (states.has(parent)) {
        const own = states.get(path), above = states.get(parent);
        above.total += own.total; above.selected += own.selected; above.children++;
      }
    }
    for (const state of states.values()) { state.checked = state.selected === state.total; state.mixed = state.selected > 0 && state.selected < state.total; }
    return states;
  }

  function downloadSelectionOffset(selection) {
    const included = [...selection.rules].filter(([, value]) => value).map(([path]) => path);
    const roots = included.filter(path => !included.some(other => other !== path && path.startsWith(other + ' > '))).map(path => path.split(' > '));
    if (!roots.length) throw new Error('Choose a mapped folder first.');
    let common = 0;
    while (roots.every(parts => parts[common] !== undefined && parts[common] === roots[0][common])) common++;
    return Math.min(common, ...roots.map(parts => parts.length - 1));
  }

  function planMappedDownloads(displayed, metadata, selected) {
    if (metadata && typeof selected === 'string') {
      if (!metadata.folders.includes(selected)) throw new Error('Choose a mapped folder first.');
      selected = { rules: new Map([[selected, true]]) };
    }
    if (metadata && (!selected?.rules || [...selected.rules.keys()].some(path => !metadata.folders.includes(path)))) throw new Error('Choose a mapped folder first.');
    const offset = metadata ? downloadSelectionOffset(selected) : 0;
    const eligible = new Map();
    if (metadata) for (const [id, paths] of metadata.records) {
      const matching = paths.filter(parts => downloadFolderSelected(parts.join(' > '), selected));
      if (matching.length) eligible.set(id, matching.map(parts => parts.slice(offset)));
    }
    const byName = new Map(), matchedIds = new Set();
    let matched = 0;
    for (const file of displayed) {
      const paths = metadata ? eligible.get(file.id) : [[]];
      if (!paths) continue;
      matched++; matchedIds.add(file.id);
      const key = file.name.toLowerCase();
      let item = byName.get(key);
      if (!item) { item = { ...file, paths: [] }; byName.set(key, item); }
      for (const path of paths) {
        for (const part of path) {
          if (!part || /[\\/:*?"<>|\u0000-\u001f]/.test(part) || /[. ]$/.test(part) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part)) throw new Error('Folder cannot be saved safely on Windows: ' + part + '. No downloads started.');
        }
        if (!item.paths.some(existing => existing.join('/').toLowerCase() === path.join('/').toLowerCase())) item.paths.push(path);
      }
    }
    const files = Array.from(byName.values());
    return { files, matched, copies: files.reduce((sum, file) => sum + file.paths.length, 0), missing: metadata ? eligible.size - matchedIds.size : 0 };
  }

  async function openDownloadManifest(root) {
    const name = '.wrc-download-manifest.json';
    let data = { schema: 1, copies: {} };
    try {
      const handle = await root.getFileHandle(name);
      data = JSON.parse(await (await handle.getFile()).text());
      if (data.schema !== 1 || !data.copies || typeof data.copies !== 'object') throw new Error('Invalid manifest format.');
    } catch (error) { if (error.name !== 'NotFoundError') throw error; }
    let queue = Promise.resolve();
    const nativeCopies = await verifyNativeDownloadCopies(root, data);
    return { data, nativeCopies, async record(label, id, size, status = 'completed') {
      const task = queue.then(async () => {
        data.copies[label] = { id, size, status, savedAt: new Date().toISOString() };
        const handle = await root.getFileHandle(name, { create: true });
        const writer = await handle.createWritable();
        try { await writer.write(JSON.stringify(data, null, 2)); await writer.close(); }
        catch (error) { await writer.abort().catch(() => {}); throw error; }
      });
      queue = task.catch(() => {});
      return task;
    } };
  }

  async function verifyNativeDownloadCopies(root, data) {
    if (!Object.values(data.copies).some(copy => copy.native === true)) return {};
    const stage = await root.getDirectoryHandle('.wrc-recovery', { create: true });
    const requestId = Date.now() + '-' + Math.random().toString(36).slice(2);
    const handle = await stage.getFileHandle('verify.request.json', { create: true });
    const writer = await handle.createWritable();
    try { await writer.write(JSON.stringify({ requestId })); await writer.close(); }
    catch (error) { await writer.abort().catch(() => {}); throw error; }
    for (let i = 0; i < 30; i++) {
      try {
        const response = await stage.getFileHandle('verify.response.json');
        const result = JSON.parse(await (await response.getFile()).text());
        if (result.requestId === requestId) return result.copies || {};
      } catch (error) { if (error.name !== 'NotFoundError' && !(error instanceof SyntaxError)) throw error; }
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    throw new Error('Start the local recovery helper to verify long-path files before resuming.');
  }

  async function pendingDownloadTargets(root, file, log, manifest = null) {
    const targets = [];
    for (const path of file.paths) {
      const label = [...path, file.name].join('/');
      const verified = manifest?.nativeCopies?.[label];
      if (verified?.exists && verified.size > 0 && verified.size === manifest.data.copies[label]?.size) {
        log('SKIPPED: ' + label + ' - verified on disk by local helper'); continue;
      }
      let folder = root;
      try { for (const part of path) folder = await folder.getDirectoryHandle(part, { create: true }); }
      catch (error) { if (error.name !== 'NotFoundError') throw error; targets.push({ folder: null, label }); continue; }
      if (await downloadFileExists(folder, file.name)) {
        const handle = await folder.getFileHandle(file.name);
        const size = handle.getFile ? (await handle.getFile()).size : null;
        const previous = manifest?.data.copies[label];
        if (previous && size !== null && previous.size !== size) throw new Error('Existing file size differs from manifest: ' + label + '. Preserved; review before replacing.');
        log('SKIPPED: ' + label + ' - non-empty file already exists');
      } else targets.push({ folder, label });
    }
    return targets;
  }

  async function stageDownloadRecovery(options, label, blob) {
    const stage = await options.root.getDirectoryHandle('.wrc-recovery', { create: true });
    const dataName = options.file.id + '.bin';
    const index = options.file.paths.findIndex(path => [...path, options.file.name].join('/') === label);
    if (index < 0) throw new Error('Recovery destination is not in the download plan.');
    const write = async (name, value) => {
      const handle = await stage.getFileHandle(name, { create: true }); const writer = await handle.createWritable();
      try { await writer.write(value); await writer.close(); } catch (error) { await writer.abort().catch(() => {}); throw error; }
    };
    await write(dataName, blob);
    await write(options.file.id + '-' + index + '.job.json', JSON.stringify({ schema: 1, id: options.file.id, relativePath: label, dataName, size: blob.size }));
    options.onStage(label);
  }

  async function saveDownloadCopies(targets, name, blob, isStopped, log, options = null) {
    for (const { folder, label } of targets) {
      if (isStopped()) return;
      if (folder && await downloadFileExists(folder, name)) { log('SKIPPED: ' + label + ' - file already exists'); continue; }
      try {
        if (!folder) throw Object.assign(new Error('Folder path unavailable to browser'), { name: 'NotFoundError' });
        const handle = await folder.getFileHandle(name, { create: true });
        const writer = await handle.createWritable();
        if (isStopped()) { await writer.abort().catch(() => {}); return; }
        try { await writer.write(blob); await writer.close(); }
        catch (error) { await writer.abort().catch(() => {}); throw error; }
        if (handle.getFile && (await handle.getFile()).size !== blob.size) throw new Error('Saved file size does not match response.');
      } catch (error) {
        if (options && error.name === 'NotFoundError' && !isStopped()) { await stageDownloadRecovery(options, label, blob); continue; }
        throw error;
      }
      if (options?.manifest) await options.manifest.record(label, options.file.id, blob.size);
      log('Saved: ' + label);
    }
  }

  async function downloadFileExists(folder, name) {
    try { const handle = await folder.getFileHandle(name); return handle.getFile ? (await handle.getFile()).size > 0 : true; }
    catch (error) { if (error.name === 'NotFoundError') return false; throw error; }
  }

  function resolveDownloadUrl(id, signal) {
    return new Promise((resolve, reject) => {
      if (!window.apex?.server?.process) { reject(new Error('APEX download helper unavailable. Reload Manage Documents.')); return; }
      let request;
      const abort = () => { request?.abort?.(); reject(new DOMException('Aborted', 'AbortError')); };
      if (signal.aborted) { abort(); return; }
      signal.addEventListener('abort', abort, { once: true });
      const cleanup = () => signal.removeEventListener('abort', abort);
      try {
        request = window.apex.server.process('DOWNLOAD_DOCUMENT', { x01: id }, {
          dataType: 'json',
          success(data) {
            cleanup();
            try {
              const url = new URL(data?.url);
              if (url.protocol !== 'https:' || url.hostname !== 'objectstorage.uk-gov-london-1.oraclegovcloud.uk') throw new Error('Invalid download location');
              resolve(url.href);
            } catch (_) { reject(new Error('Download process did not return a valid storage URL')); }
          },
          error(xhr, status) {
            cleanup();
            if (status === 'abort') { reject(new DOMException('Aborted', 'AbortError')); return; }
            const error = new Error('Download URL request failed' + (xhr?.status ? ': HTTP ' + xhr.status : ''));
            error.httpStatus = xhr?.status || null;
            error.retryAfter = safeDownloadRetryAfter(xhr?.getResponseHeader?.('Retry-After'));
            reject(error);
          }
        });
      } catch (_) { cleanup(); reject(new Error('Download URL request could not start')); }
    });
  }

  function rememberDownloadFolder(handle, key = 'last_download_folder') {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open('wrc_toolkit_downloads', 1);
      request.onupgradeneeded = () => request.result.createObjectStore('folders');
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const db = request.result;
        let result;
        try {
          const transaction = db.transaction('folders', handle ? 'readwrite' : 'readonly');
          const store = transaction.objectStore('folders');
          const operation = handle ? store.put(handle, key) : store.get(key);
          operation.onsuccess = () => { result = operation.result; };
          transaction.oncomplete = () => { db.close(); resolve(result); };
          transaction.onabort = transaction.onerror = () => { db.close(); reject(transaction.error || new Error('Folder storage failed')); };
        } catch (error) { db.close(); reject(error); }
      };
    });
  }

  function collectDisplayedDownloads(root, onSkip = () => {}) {
    const normalize = text => String(text || '').replace(/\s+/g, ' ').trim().toLowerCase();
    const files = new Map();
    const skippedIds = new Set();
    let reportFound = false;
    for (const table of root.querySelectorAll('table')) {
      const header = table.querySelector('tr');
      if (!header) continue;
      const headers = Array.from(header.querySelectorAll('th,td'), cell => normalize(cell.textContent));
      const filenameIndex = headers.indexOf('file name');
      const downloadIndex = headers.indexOf('download');
      const entriesIndex = headers.findIndex(h => /^#?\s*folder entries$/.test(h));
      if (filenameIndex < 0 || downloadIndex < 0) continue;
      if (entriesIndex < 0) continue;
      reportFound = true;
      for (const row of Array.from(table.querySelectorAll('tr')).slice(1)) {
        if (row.hidden || row.getAttribute('aria-hidden') === 'true' || row.getClientRects().length === 0) continue;
        const cells = row.querySelectorAll('td,th');
        const link = cells[downloadIndex]?.querySelector('a[href]');
        if (!link) continue;
        const url = new URL(link.getAttribute('href'), location.href);
        const id = url.searchParams.get('ai_download_file_id') || decodeURIComponent(url.href).match(/ai_download_file_id=(\d+)/i)?.[1];
        if (!id || !/^\d+$/.test(id) || url.origin !== location.origin) continue;
        const name = String(cells[filenameIndex]?.textContent || '').trim();
        if (/^0$/.test(normalize(cells[entriesIndex]?.textContent))) {
          if (!skippedIds.has(id)) { skippedIds.add(id); onSkip({ id, name }); }
          continue;
        }
        if (!name || /[\\/:*?"<>|\u0000-\u001f]/.test(name) || /[. ]$/.test(name) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name)) {
          throw new Error('An original filename cannot be saved safely on Windows: ' + (name || '[blank]') + '. No downloads started.');
        }
        files.set(id, { id, name, url: url.href });
      }
    }
    if (reportFound) return Array.from(files.values());
    throw new Error('Manage Documents report not found. Show the File Name, Download and # Folder Entries columns.');
  }

  function fileNameFromDisposition(header) {
    const text = String(header || '');
    const star = text.match(/filename\*\s*=\s*([^']*)'[^']*'([^;]+)/i);
    if (star) { try { return decodeURIComponent(star[2].trim()); } catch (_) {} }
    const quoted = text.match(/filename\s*=\s*"((?:[^"\\]|\\.)*)"/i);
    if (quoted) return quoted[1].replace(/\\(.)/g, '$1').trim();
    const plain = text.match(/filename\s*=\s*([^;]+)/i);
    return plain ? plain[1].trim() : '';
  }

  function fileNameFromStorageUrl(url, id) {
    try {
      const path = new URL(url).pathname;
      const at = path.indexOf('/o/');
      if (at < 0) return '';
      const object = decodeURIComponent(path.slice(at + 3));
      return object.startsWith(id + '-') ? object.slice(id.length + 1) : object;
    } catch (_) { return ''; }
  }

  function isSafeWindowsFileName(name) {
    return !!name && !/[\\/:*?"<>|\u0000-\u001f]/.test(name) && !/[. ]$/.test(name) && !/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name);
  }

  // Quick download from home page cards. The original file name is only known
  // once the storage response arrives, so duplicate and existing-file checks
  // happen after the headers and before the body is read. Stop rules mirror
  // the Manage Documents loop in startDownloadView; keep them in step.
  async function saveCardFile(file, destination, controller, seenNames, isStopped) {
    const storageUrl = await resolveDownloadUrl(file.id, controller.signal);
    let response;
    try { response = await fetch(storageUrl, { credentials: 'omit', signal: controller.signal }); }
    catch (error) {
      if (error.name === 'AbortError') throw error;
      throw new Error('Storage fetch failed (network or browser cross-origin restriction). Run stopped.');
    }
    if (!response.ok) throw new Error('HTTP ' + response.status);
    if (response.redirected && /login|signin|sign-in/i.test(response.url)) throw new Error('Session expired. Sign in again.');
    const name = fileNameFromDisposition(response.headers?.get('content-disposition')) || fileNameFromStorageUrl(storageUrl, file.id);
    if (!name) throw new Error('Could not work out the original file name');
    if (!isSafeWindowsFileName(name)) throw new Error('Original file name cannot be saved safely on Windows: ' + name);
    const key = name.toLowerCase();
    if (seenNames.has(key)) { controller.abort(); return { skipped: 'duplicate filename', name }; }
    seenNames.add(key);
    if (await downloadFileExists(destination, name)) { controller.abort(); return { skipped: 'file already exists', name }; }
    const blob = await response.blob();
    if (isStopped()) return { stopped: true, name };
    if (!blob.size) throw new Error('Empty response');
    if (/text\/html|application\/xhtml/i.test(blob.type) && !/\.html?$/i.test(name)) throw new Error('Server returned a web page instead of the file; file may be unavailable.');
    if (await downloadFileExists(destination, name)) throw new Error('File already exists: ' + name + '; skipped to avoid overwriting');
    const handle = await destination.getFileHandle(name, { create: true });
    const writer = await handle.createWritable();
    try { await writer.write(blob); await writer.close(); }
    catch (error) { await writer.abort().catch(() => {}); throw error; }
    return { saved: true, name };
  }

  async function downloadCardFiles(files, destination, delaySeconds, hooks) {
    const { log, status, isStopped, setController } = hooks;
    const result = { done: 0, failed: 0, skipped: 0, stopped: false };
    const seenNames = new Set();
    let halted = false;
    for (let i = 0; i < files.length && !halted && !isStopped(); i++) {
      const file = files[i];
      status(`Downloading ${i + 1}/${files.length}: ${file.title}`);
      const controller = new AbortController();
      setController(controller);
      const timeout = setTimeout(() => controller.abort(), 120000);
      try {
        const outcome = await saveCardFile(file, destination, controller, seenNames, isStopped);
        if (outcome.stopped) break;
        if (outcome.skipped) { result.skipped++; log(`SKIPPED: ${outcome.name} [ID ${file.id}] - ${outcome.skipped}`); }
        else { result.done++; log('Saved: ' + outcome.name); }
      } catch (error) {
        if (isStopped()) break;
        result.failed++;
        log(`FAILED: ${file.title} [ID ${file.id}] - ` + (error.name === 'AbortError' ? 'Download timed out' : error.message));
        if (/HTTP (401|403|429|503)|Session expired|Storage fetch failed|APEX download helper unavailable/i.test(error.message)) {
          halted = true;
          log('Run stopped. Resolve the session or server issue before trying again.');
        }
      } finally { clearTimeout(timeout); setController(null); }
      if (i < files.length - 1 && !halted && !isStopped()) {
        const until = Date.now() + delaySeconds * 1000;
        while (!isStopped() && Date.now() < until) await new Promise(resolve => setTimeout(resolve, 200));
      }
    }
    result.stopped = halted || isStopped();
    return result;
  }



  // ── Pacing config ──────────────────────────────────────────────────────────
  const SCRIPT_VERSION  = '4.32';
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
      display:grid; grid-template-columns:repeat(5, 1fr); gap:4px;
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
      <button class="wrc-tab" type="button" data-tab="download">Download</button>
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

      <div class="wrc-pane" data-pane="download">
        <label>Quick Download</label>
        <div style="font-size:11px;color:#666;margin-bottom:5px">
          Choose from the document cards currently shown on this page and save the files to a folder. External Link cards have no file and are skipped. Original file names; duplicate names and existing files are skipped, never overwritten.
        </div>
        <div id="wrc-cdl-folder-name" style="border:1px solid #d0d7de;border-radius:4px;padding:7px 8px;background:#f6f8fa;font-size:12px;overflow-wrap:anywhere">No folder selected.</div>
        <label style="font-weight:400">Pause between files (seconds): <input id="wrc-cdl-delay" type="number" min="1" max="60" value="3" style="width:50px"></label>
        <div class="wrc-row">
          <button class="wrc-btn wrc-btn-grey" id="wrc-btn-cdl-folder">Choose Folder</button>
          <button class="wrc-btn wrc-btn-primary" id="wrc-btn-cdl-choose">Choose Documents</button>
          <button class="wrc-btn wrc-btn-danger" id="wrc-btn-cdl-stop" disabled>Stop</button>
        </div>
        <div id="wrc-cdl-status" role="status" aria-live="polite" style="font-size:11px;margin-top:5px;color:#666">Ready.</div>
        <div id="wrc-cdl-log" style="max-height:140px;overflow:auto;font-size:11px;white-space:pre-wrap;margin-top:4px"></div>
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

  // ── Quick download of visible document cards ──────────────────────────────
  const CARD_FOLDER_KEY = 'last_card_download_folder';
  const elCdlFolder = $('wrc-cdl-folder-name');
  const elCdlStatus = $('wrc-cdl-status');
  const elCdlLog = $('wrc-cdl-log');
  const elCdlDelay = $('wrc-cdl-delay');
  const btnCdlFolder = $('wrc-btn-cdl-folder');
  const btnCdlChoose = $('wrc-btn-cdl-choose');
  const btnCdlStop = $('wrc-btn-cdl-stop');
  let cardDlFolder = null;
  let cardDlBusy = false;
  let cardDlStopped = false;
  let cardDlController = null;

  const cdlStatus = msg => { elCdlStatus.textContent = msg; };
  const cdlLog = msg => {
    const row = document.createElement('div');
    row.textContent = msg;
    elCdlLog.appendChild(row);
    elCdlLog.scrollTop = elCdlLog.scrollHeight;
  };

  function collectCardDownloads(root) {
    const seen = new Set();
    const rows = [];
    for (const link of root.querySelectorAll('a[href*="ai_download_file_id"]')) {
      let url;
      try { url = new URL(link.getAttribute('href'), location.href); } catch (_) { continue; }
      const id = url.searchParams.get('ai_download_file_id') || '';
      if (!/^\d+$/.test(id) || url.origin !== location.origin || seen.has(id)) continue;
      const card = cardContainerForLink(link);
      if (!card || card.hidden || card.getClientRects().length === 0) continue;
      seen.add(id);
      rows.push({ id, title: titleForCard(card, id) });
    }
    return rows;
  }

  rememberDownloadFolder(undefined, CARD_FOLDER_KEY).then(saved => {
    if (saved?.kind === 'directory') {
      cardDlFolder = saved;
      elCdlFolder.textContent = 'Remembered folder: ' + saved.name;
      cdlStatus('Last quick-download folder restored. You may be asked to approve access when you download.');
    }
  }).catch(() => { cdlStatus('Folder memory unavailable. Choose a folder for this session.'); });

  btnCdlFolder.addEventListener('click', async () => {
    if (cardDlBusy) return;
    if (!window.showDirectoryPicker) {
      cdlStatus('Folder saving is unavailable in this browser. Use Chrome or Edge.');
      return;
    }
    try {
      cardDlFolder = await window.showDirectoryPicker({ mode: 'readwrite' });
      elCdlFolder.textContent = 'Folder: ' + cardDlFolder.name;
      try { await rememberDownloadFolder(cardDlFolder, CARD_FOLDER_KEY); }
      catch (_) { cdlStatus('Folder selected, but could not remember it for the next refresh.'); }
    } catch (error) {
      if (error.name !== 'AbortError') cdlStatus('Folder selection failed: ' + error.message);
    }
  });

  btnCdlStop.addEventListener('click', () => {
    cardDlStopped = true;
    cardDlController?.abort();
    cdlStatus('Stopping. Any file already being saved will finish.');
  });

  async function startCardDownload(files) {
    if (cardDlBusy) return;
    const delay = Number(elCdlDelay.value);
    if (!Number.isFinite(delay) || delay < 1 || delay > 60) { cdlStatus('Choose a pause between 1 and 60 seconds.'); return; }
    if (cardDlFolder.queryPermission) {
      try {
        let permission = await cardDlFolder.queryPermission({ mode: 'readwrite' });
        if (permission !== 'granted') permission = await cardDlFolder.requestPermission({ mode: 'readwrite' });
        if (permission !== 'granted') { cdlStatus('Folder access was not granted. Allow access or choose another folder.'); return; }
      } catch (error) { cdlStatus('Cannot access the remembered folder. Choose it again: ' + error.message); return; }
    }
    cardDlBusy = true;
    cardDlStopped = false;
    btnCdlChoose.disabled = btnCdlFolder.disabled = elCdlDelay.disabled = true;
    btnCdlStop.disabled = false;
    elCdlLog.replaceChildren();
    try {
      const result = await downloadCardFiles(files, cardDlFolder, delay, {
        log: cdlLog,
        status: cdlStatus,
        isStopped: () => cardDlStopped,
        setController: controller => { cardDlController = controller; }
      });
      cdlStatus(`${result.stopped ? 'Stopped' : 'Finished'}: ${result.done}/${files.length} saved, ${result.failed} failed, ${result.skipped} skipped. See results below.`);
    } catch (error) {
      cdlStatus('Download stopped unexpectedly: ' + error.message);
    } finally {
      cardDlBusy = false;
      btnCdlChoose.disabled = btnCdlFolder.disabled = elCdlDelay.disabled = false;
      btnCdlStop.disabled = true;
    }
  }

  function openDownloadChooser(rows) {
    closeLinkChooser();

    const modal = document.createElement('div');
    modal.id = 'wrc-link-modal';
    modal.innerHTML = `
      <div id="wrc-link-dialog" role="dialog" aria-modal="true" aria-label="Choose documents to download">
        <div id="wrc-link-head">
          <span>Choose Documents to Download</span>
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
          <button class="wrc-btn wrc-btn-success" type="button" id="wrc-dlc-go">Download Selected</button>
        </div>
      </div>
    `;

    const list = modal.querySelector('#wrc-link-list');
    rows.forEach((row, i) => {
      const label = document.createElement('label');
      label.className = 'wrc-link-choice';
      label.innerHTML = `
        <input class="wrc-link-check" type="checkbox" checked data-index="${i}">
        <span><span class="wrc-link-title">${esc(row.title)}</span></span>
      `;
      list.appendChild(label);
    });

    modal.querySelector('#wrc-link-x').addEventListener('click', closeLinkChooser);
    modal.querySelector('#wrc-link-cancel').addEventListener('click', closeLinkChooser);
    modal.addEventListener('click', e => { if (e.target === modal) closeLinkChooser(); });
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
    modal.querySelector('#wrc-dlc-go').addEventListener('click', () => {
      const selected = selectedLinkRows(modal, rows);
      if (!selected.length) { cdlStatus('No documents selected.'); return; }
      closeLinkChooser();
      startCardDownload(selected);
    });

    document.body.appendChild(modal);
    updateLinkCount(modal, rows);
  }

  btnCdlChoose.addEventListener('click', () => {
    if (cardDlBusy) return;
    if (!cardDlFolder) { cdlStatus('Choose a download folder first.'); return; }
    const rows = collectCardDownloads(document);
    if (!rows.length) { cdlStatus('No downloadable document cards found on this page.'); return; }
    openDownloadChooser(rows);
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

  // ── Auto-default Published Start Date on manual Add (not Edit) forms ──────
  // A blank Start Date silently blocks Add/Add Link until it's filled in.
  // Default it to "now, rounded down to the last half hour" so the item
  // publishes live immediately instead of nagging every single time.
  // Skipped whenever the form is a saved Edit (Apply Changes/Delete present)
  // so an existing item's deliberately-blank Start Date is never touched.
  const APEX_MONTH_ABBR = ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'];

  function roundedPastHalfHour(d) {
    const r = new Date(d);
    r.setMinutes(r.getMinutes() < 30 ? 0 : 30, 0, 0);
    return r;
  }

  function formatApexDateTime(d) {
    const dd = String(d.getDate()).padStart(2, '0');
    const mon = APEX_MONTH_ABBR[d.getMonth()];
    const hh = String(d.getHours()).padStart(2, '0');
    const mi = String(d.getMinutes()).padStart(2, '0');
    return `${dd}-${mon}-${d.getFullYear()} ${hh}:${mi}`;
  }

  // Works against a directly-supplied field element rather than a hardcoded
  // id, since Add Document (manage-document) and Add External Link
  // (manage-external-link) are different pages with different item id
  // prefixes but the same "...PUBLISH...START...DATE..." naming pattern.
  function autofillPublishedStartDateField(doc, ifWin, field) {
    if (!field || field.value.trim() || isSavedEditForm(doc)) return;
    setItemValue(doc, ifWin, field.id, formatApexDateTime(roundedPastHalfHour(new Date())));
  }

  function findPublishStartDateFields(doc) {
    return Array.from(doc.querySelectorAll('input, select, textarea'))
      .filter(el => /PUBLISH.*START.*DATE/i.test(el.id || ''));
  }

  // findIframe() (used by the bulk-upload automation elsewhere in this
  // script) only matches manage-document, so it never sees the Add External
  // Link dialog, which loads manage-external-link instead. This one covers
  // both, purely for the manual-use helpers below.
  function findManualFormIframe() {
    return Array.from(document.querySelectorAll('iframe')).find(f => {
      const src = f.src || '';
      return src.includes('manage-document') || src.includes('manage-external-link');
    });
  }

  // ── Watcher: Add Document / Add External Link manual-use helpers ──────────
  function startManualFormWatcher() {
    setInterval(() => {
      const iframe = findManualFormIframe();
      if (!iframe) return;
      let doc;
      try { doc = iframe.contentDocument; } catch (_) { return; }
      if (!doc) return;
      injectCleanNameButton(doc, iframe.contentWindow);
      findPublishStartDateFields(doc).forEach(f => autofillPublishedStartDateField(doc, iframe.contentWindow, f));
    }, 700);
  }
  startManualFormWatcher();

})();
