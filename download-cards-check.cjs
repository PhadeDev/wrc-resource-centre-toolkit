const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const source = fs.readFileSync(__dirname + '/wrc-bulk-uploader.user.js', 'utf8');
const fragment = source.slice(source.indexOf('  function startDownloadView'), source.indexOf('  const SCRIPT_VERSION'));
const collector = source.match(/  function collectCardDownloads[\s\S]*?\r?\n  }\r?\n/)[0];
const ORIGIN = 'https://westminster.cadetnet.mod.uk';
const STORAGE = 'https://objectstorage.uk-gov-london-1.oraclegovcloud.uk/p/tok/n/ns/b/B/o/';
const context = vm.createContext({
  location: { href: ORIGIN + '/app/r/westminster/resource_centre/home', origin: ORIGIN, pathname: '/home' },
  URL, Map, Set, Array, console, setTimeout, clearTimeout, AbortController, DOMException, Date, Error, Promise
});
vm.runInContext(fragment, context);
vm.runInContext(collector, context);
const call = (name, ...args) => { context.__args = args; return vm.runInContext(name + '(...__args)', context); };

assert.equal(call('fileNameFromDisposition', 'attachment; filename="20260818-ACSO1210_Activity_Owner_Brief(RC).pdf"'), '20260818-ACSO1210_Activity_Owner_Brief(RC).pdf');
assert.equal(call('fileNameFromDisposition', "attachment; filename*=UTF-8''Caf%C3%A9%20Menu.pdf"), 'Café Menu.pdf');
assert.equal(call('fileNameFromDisposition', 'attachment; filename=plain.pdf'), 'plain.pdf');
assert.equal(call('fileNameFromDisposition', 'attachment; filename="a \\"q\\" b.pdf"'), 'a "q" b.pdf');
assert.equal(call('fileNameFromDisposition', 'inline'), '');
assert.equal(call('fileNameFromDisposition', null), '');
assert.equal(call('fileNameFromStorageUrl', STORAGE + '6425-20260818-Brief(RC).pdf', '6425'), '20260818-Brief(RC).pdf');
assert.equal(call('fileNameFromStorageUrl', STORAGE + '20260818-Brief.pdf', '6425'), '20260818-Brief.pdf', 'Only the document id prefix is stripped');
assert.equal(call('fileNameFromStorageUrl', 'https://x.test/no-object-segment', '1'), '');
for (const name of ['a.pdf', 'ok (RC).pdf', '20260818-x.docx']) assert.equal(call('isSafeWindowsFileName', name), true, name);
for (const name of ['', 'a:b.pdf', 'CON.pdf', 'name.', 'a/b.pdf', 'x*.pdf']) assert.equal(call('isSafeWindowsFileName', name), false, name);

const card = (options = {}) => ({ hidden: !!options.hidden, getClientRects: () => options.invisible ? [] : [{}], title: options.title });
const link = (href, owner) => ({ getAttribute: () => href, owner });
context.cardContainerForLink = item => item.owner;
context.titleForCard = (owner, id) => owner.title || id;
const links = [
  link('/app/r/westminster/resource_centre/home?ai_download_file_id=100&request=R', card({ title: 'Doc A' })),
  link('/app/r/westminster/resource_centre/home?ai_download_file_id=100&request=R', card({ title: 'Duplicate of A' })),
  link('https://other.test/home?ai_download_file_id=101', card()),
  link('?ai_download_file_id=abc', card()),
  link('?ai_download_file_id=102', card({ hidden: true })),
  link('?ai_download_file_id=103', card({ invisible: true })),
  link(ORIGIN + '/app/x?ai_download_file_id=104', card({ title: 'Doc D' })),
  link('?ai_download_file_id=105', null)
];
context.root = { querySelectorAll: () => links };
const rows = vm.runInContext('collectCardDownloads(root)', context);
assert.equal(rows.length, 2, 'Only visible, same-origin, numeric-id cards, one per id');
assert.equal(rows[0].id + rows[1].id, '100104');
assert.equal(rows[0].title + '|' + rows[1].title, 'Doc A|Doc D');

function directory(existing = []) {
  const files = new Map(existing.map(name => [name, true]));
  const written = [];
  return {
    written,
    async getFileHandle(name, options) {
      if (!files.has(name)) {
        if (!options?.create) throw Object.assign(new Error('missing'), { name: 'NotFoundError' });
        files.set(name, true);
      }
      return { async createWritable() { return { async write(blob) { written.push({ name, size: blob.size }); }, async close() {}, async abort() {} }; } };
    }
  };
}

function install(spec) {
  const resolved = [], signals = {}, blobsRead = [];
  context.window = { apex: { server: { process(name, data, options) {
    assert.equal(name, 'DOWNLOAD_DOCUMENT');
    resolved.push(data.x01);
    const timer = setTimeout(() => options.success({ url: STORAGE + data.x01 + '-' + encodeURIComponent(spec[data.x01].object || 'x.bin') }), 0);
    return { abort() { clearTimeout(timer); options.error({ status: 0 }, 'abort'); } };
  } } } };
  context.fetch = async (url, options) => {
    assert.equal(options.credentials, 'omit');
    const id = decodeURIComponent(url.slice(STORAGE.length)).match(/^(\d+)-/)[1];
    signals[id] = options.signal;
    const s = spec[id];
    if (s.fetchOk === false) return { ok: false, status: s.status };
    return {
      ok: true, redirected: false, url,
      headers: { get: key => key === 'content-disposition' ? (s.disposition ?? null) : null },
      async blob() { blobsRead.push(id); if (s.onBlob) s.onBlob(); return { size: s.size ?? 4, type: s.type ?? 'application/octet-stream' }; }
    };
  };
  return { resolved, signals, blobsRead };
}

function hooks(stop = { value: false }) {
  const logs = [], statuses = [];
  return { logs, statuses, stop, api: { log: message => logs.push(message), status: message => statuses.push(message), isStopped: () => stop.value, setController: () => {} } };
}

const files = (...ids) => ids.map(id => ({ id, title: 'Title ' + id }));
const attach = name => 'attachment; filename="' + name + '"';
async function run(spec, ids, dest, stop) {
  const env = install(spec);
  const h = hooks(stop);
  context.testFiles = files(...ids);
  context.testDest = dest;
  context.testHooks = h.api;
  const result = await vm.runInContext('downloadCardFiles(testFiles, testDest, 0, testHooks)', context);
  return { result, env, h };
}

(async () => {
  let dest = directory(['existing.pdf']);
  let out = await run({
    1: { object: 'Alpha.pdf', disposition: attach('Alpha (RC).pdf') },
    2: { object: 'x.pdf', disposition: attach('ALPHA (rc).PDF') },
    3: { object: 'e.pdf', disposition: attach('existing.pdf') },
    4: { object: 'Delta.docx', disposition: attach('Delta.docx') }
  }, ['1', '2', '3', '4'], dest);
  assert.equal(out.result.done, 2);
  assert.equal(out.result.skipped, 2);
  assert.equal(out.result.failed, 0);
  assert.equal(out.result.stopped, false);
  assert.deepEqual(dest.written.map(item => item.name), ['Alpha (RC).pdf', 'Delta.docx']);
  assert.deepEqual(out.env.blobsRead, ['1', '4'], 'Skipped files must not have their body read');
  assert.equal(out.env.signals['2'].aborted, true);
  assert.equal(out.env.signals['3'].aborted, true);
  assert.ok(out.h.logs.includes('Saved: Alpha (RC).pdf'));
  assert.ok(out.h.logs.includes('SKIPPED: ALPHA (rc).PDF [ID 2] - duplicate filename'));
  assert.ok(out.h.logs.includes('SKIPPED: existing.pdf [ID 3] - file already exists'));

  dest = directory();
  out = await run({ 5: { object: '20260818-Foo.pdf', disposition: null } }, ['5'], dest);
  assert.deepEqual(dest.written.map(item => item.name), ['20260818-Foo.pdf'], 'Falls back to the storage object name without the id prefix');

  dest = directory();
  out = await run({
    6: { object: 'a.pdf', disposition: attach('a.pdf'), type: 'text/html;charset=utf-8' },
    7: { object: 'b.pdf', disposition: attach('b.pdf') }
  }, ['6', '7'], dest);
  assert.equal(out.result.failed, 1);
  assert.equal(out.result.done, 1);
  assert.equal(out.result.stopped, false, 'A web page instead of a file must not halt the run');
  assert.deepEqual(dest.written.map(item => item.name), ['b.pdf']);

  dest = directory();
  out = await run({
    8: { object: 'x', disposition: attach('a:b.pdf') },
    9: { object: 'y', disposition: attach('ok.pdf') }
  }, ['8', '9'], dest);
  assert.equal(out.result.failed, 1);
  assert.equal(out.result.done, 1);
  assert.match(out.h.logs.find(item => item.startsWith('FAILED')), /safely on Windows/);

  dest = directory();
  out = await run({
    10: { object: 'x', fetchOk: false, status: 429 },
    11: { object: 'y', disposition: attach('later.pdf') }
  }, ['10', '11'], dest);
  assert.deepEqual(out.env.resolved, ['10'], 'Throttling stops the batch');
  assert.equal(out.result.stopped, true);
  assert.equal(dest.written.length, 0);
  assert.ok(out.h.logs.some(item => /Run stopped/.test(item)));

  dest = directory();
  const stop = { value: false };
  out = await run({
    12: { object: 'x', disposition: attach('stopme.pdf'), onBlob: () => { stop.value = true; } },
    13: { object: 'y', disposition: attach('never.pdf') }
  }, ['12', '13'], dest, stop);
  assert.equal(out.result.stopped, true);
  assert.equal(out.result.done, 0);
  assert.equal(out.result.failed, 0);
  assert.equal(dest.written.length, 0, 'Stopping prevents saving the active response');
  assert.deepEqual(out.env.resolved, ['12']);

  dest = directory();
  out = await run({ 14: { object: 'x', disposition: attach('empty.pdf'), size: 0 } }, ['14'], dest);
  assert.equal(out.result.failed, 1);
  assert.match(out.h.logs[0], /Empty response/);

  dest = directory();
  install({ 15: { object: 'x', disposition: attach('n.pdf') } });
  context.fetch = async () => { throw new TypeError('Failed to fetch'); };
  const h = hooks();
  context.testFiles = files('15', '15');
  context.testDest = dest;
  context.testHooks = h.api;
  const failed = await vm.runInContext('downloadCardFiles(testFiles, testDest, 0, testHooks)', context);
  assert.equal(failed.failed, 1);
  assert.equal(failed.stopped, true, 'Cross-origin or network failure stops the run');

  console.log('Card download checks passed: names, duplicates, existing files, HTML, throttling, unsafe names, Stop, network failure, card collection.');
})().catch(error => { console.error(error); process.exitCode = 1; });
