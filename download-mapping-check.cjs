const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const source = fs.readFileSync(__dirname + '/wrc-bulk-uploader.user.js', 'utf8');
const fragment = source.slice(source.indexOf('  function startDownloadView'), source.indexOf('  const SCRIPT_VERSION'));
const context = vm.createContext({ Map, Set, Array, URL, console });
vm.runInContext(fragment, context);
const parse = text => context.parseDownloadMetadata(text);
const csv = '\uFEFFSelect,Display Name,Folder Path\r\n1,"A, quoted ""title""",Top > Syllabus > One:Top > Syllabus > Two:Other > One\r\n2,B,Other > One\r\n3,C,Top > Syllabus > Three\r\n4,D,Top > Syllabus > Four';
const mapping = parse(csv);
assert.equal(mapping.records.size, 4);
assert(mapping.folders.includes('Top > Syllabus'));
assert.equal(context.parseDownloadCsv('A,B\n"line\nbreak",value')[1][0], 'line\nbreak');
assert.throws(() => parse('Select,Folder Path\n1,"Unclosed'), /Unclosed/);
assert.throws(() => parse('ID,Folder\n1,A'), /Select and Folder Path/);
assert.throws(() => parse('Select,Folder Path\nno,A'), /invalid document ID/);
assert.throws(() => parse('Select,Folder Path\n1,A,extra'), /number of columns/);
const displayed = [{ id:'1',name:'same.pdf' },{ id:'2',name:'same.pdf' },{ id:'3',name:'same.pdf' }];
const plan = context.planMappedDownloads(displayed, mapping, 'Top > Syllabus');
assert.equal(plan.matched, 2, 'Exclude unrelated IDs, even with identical filenames');
assert.equal(plan.missing, 1, 'Detect mapped IDs absent from eligible displayed report');
assert.equal(plan.files.length, 1, 'Fetch duplicate names once');
assert.equal(plan.copies, 3, 'Merge target folders from duplicate document names');
assert.deepEqual(JSON.parse(JSON.stringify(plan.files[0].paths)), [['Syllabus','One'],['Syllabus','Two'],['Syllabus','Three']]);
assert.equal(context.planMappedDownloads(displayed, null, '').files.length, 1, 'Flat mode retains duplicate policy');
assert.throws(() => context.planMappedDownloads(displayed, mapping, ''), /Choose a mapped folder/);
for (const bad of ['..','CON','bad/name','trailing.']) {
  const unsafe = parse('Select,Folder Path\n1,Top > Syllabus > '+bad);
  assert.throws(() => context.planMappedDownloads(displayed, unsafe, 'Top > Syllabus'), /safely on Windows/);
}

(async () => {
  const disk = new Map(), writes = [], logs = [];
  function dir(path) {
    return { async getDirectoryHandle(name, options) {
      assert.equal(options.create, true); return dir(path+'/'+name);
    }, async getFileHandle(name, options) {
      const key=path+'/'+name;
      if (!options?.create && !disk.has(key)) throw Object.assign(new Error(), {name:'NotFoundError'});
      return { async createWritable() { return {
        async write(blob) { assert.equal(blob.size,4); }, async close() { disk.set(key,true); writes.push(key); }, async abort() {}
      }; } };
    } };
  }
  disk.set('root/Syllabus/One/same.pdf',true);
  let targets=await context.pendingDownloadTargets(dir('root'),plan.files[0],m=>logs.push(m));
  assert.equal(targets.length,2,'Skip existing copy while retaining other destinations');
  await context.saveDownloadCopies(targets,'same.pdf',{size:4},()=>false,m=>logs.push(m));
  assert.deepEqual(writes,['root/Syllabus/Two/same.pdf','root/Syllabus/Three/same.pdf']);
  targets=await context.pendingDownloadTargets(dir('root'),plan.files[0],()=>{});
  assert.equal(targets.length,0,'Repeat run requires no fetch if all copies exist');
  await context.saveDownloadCopies([{folder:dir('root'),label:'stopped'}],'stop.pdf',{size:4},()=>true,()=>{});
  assert.equal(writes.length,2,'Stop prevents subsequent copies');
  disk.set('root/race.pdf',true);
  await context.saveDownloadCopies([{folder:dir('root'),label:'race'}],'race.pdf',{size:4},()=>false,()=>{});
  assert.equal(writes.length,2,'Recheck file existence immediately before write');
  await assert.rejects(context.pendingDownloadTargets({getDirectoryHandle:async()=>{throw Object.assign(new Error(),{name:'NotAllowedError'})}},plan.files[0],()=>{}),{name:'NotAllowedError'});
  let aborted=false;
  const broken={getFileHandle:async(_,options)=>{if(!options)throw Object.assign(new Error(),{name:'NotFoundError'});return {createWritable:async()=>({write:async()=>{throw new Error('disk full')},abort:async()=>{aborted=true}})};}};
  await assert.rejects(context.saveDownloadCopies([{folder:broken,label:'broken'}],'a.pdf',{size:4},()=>false,()=>{}),/disk full/);
  assert(aborted,'Abort a failed write');
  if (process.argv[2] && process.argv[3]) {
    const real=parse(fs.readFileSync(process.argv[2],'utf8'));
    const rows=context.parseDownloadCsv(fs.readFileSync(process.argv[3],'utf8'));
    const headers=rows.shift();
    const id=headers.indexOf('Download'),name=headers.indexOf('File Name');
    const report=rows.map(row=>({id:row[id],name:row[name]}));
    const root='Training & Activities > Cadet Training > Army Cadet Syllabus 21 (ACS21)';
    const actual=context.planMappedDownloads(report,real,root);
    assert.equal(actual.matched,1362); assert.equal(actual.files.length,1350); assert.equal(actual.missing,0);
    assert(actual.files.every(file=>file.paths.every(path=>path[0]==='Army Cadet Syllabus 21 (ACS21)')));
    const restored=context.restoreDownloadMapping(JSON.parse(JSON.stringify({schema:1,csv:fs.readFileSync(process.argv[2],'utf8'),name:'bulk_document_metadata (1).csv',importedAt:'2026-10-12T00:00:00Z',rules:[[root,true]]})));
    const cached=context.planMappedDownloads(report,restored.metadata,restored.selection);
    assert.equal(cached.files.length,1350);assert.equal(cached.copies,1529,'Full supplied mapping round-trips through persisted snapshot');
    const selection={rules:new Map(real.folders.filter(path=>!path.includes(' > ')).map(path=>[path,true]))};
    const all=context.planMappedDownloads(report,real,selection);
    assert.equal(all.matched,3033);assert.equal(all.files.length,2992);assert.equal(all.copies,3734);
    context.setDownloadFolderSelection(selection,root,false);
    const excluded=context.planMappedDownloads(report,real,selection);
    assert(excluded.files.every(file=>file.paths.every(parts=>!parts.join(' > ').startsWith(root))), 'Select all minus ACS21 creates no copies in excluded tree');
    console.log(`Select all: ${real.folders.length} folders, ${all.files.length} files, ${all.copies} copies; ACS21 exclusion verified.`);
    console.log(`Supplied CSVs: ${actual.matched} matching IDs, ${actual.files.length} unique filenames, ${actual.copies} folder copies, ${actual.missing} missing IDs.`);
  }
  console.log('Mapping checks passed: CSV, exact ID selection, subfolders, multi-folder copies, duplicate unions, existing files, Stop, permissions, failed writes.');
})().catch(error=>{console.error(error);process.exitCode=1});
