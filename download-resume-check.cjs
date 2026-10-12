const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const source=fs.readFileSync(__dirname+'/wrc-bulk-uploader.user.js','utf8');
const context=vm.createContext({Map,Set,Array,Date,Math,setTimeout});
vm.runInContext(source.slice(source.indexOf('  async function openDownloadManifest'),source.indexOf('  function resolveDownloadUrl')),context);
const disk=new Map();let broken=false;let activeWriters=0,maxWriters=0;
function directory(path='root') {return {async getDirectoryHandle(name){return directory(path+'/'+name)},async getFileHandle(name,options){
  const key=path+'/'+name;
  if(path==='root/.wrc-recovery' && name==='verify.response.json' && disk.has('root/.wrc-recovery/verify.request.json')) {
    const request=JSON.parse(disk.get('root/.wrc-recovery/verify.request.json'));
    const data=JSON.parse(disk.get('root/.wrc-download-manifest.json'));
    const copies={};for(const label of Object.keys(data.copies)){const entry=disk.get('root/'+label);copies[label]={exists:!!entry,size:entry?.size || 0}}
    disk.set(key,JSON.stringify({requestId:request.requestId,copies}));
  }
  if(!disk.has(key)){if(!options?.create)throw Object.assign(new Error(),{name:'NotFoundError'});disk.set(key,{size:0})}
  return {async getFile(){const data=disk.get(key);return {size:typeof data==='string'?Buffer.byteLength(data):data.size,text:async()=>data}},async createWritable(){
    if(broken && name==='long.pdf')throw Object.assign(new Error('path too long'),{name:'NotFoundError'});
    let value;activeWriters++;maxWriters=Math.max(maxWriters,activeWriters);
    return {async write(data){value=data;await new Promise(r=>setTimeout(r,5))},async close(){disk.set(key,value);activeWriters--},async abort(){activeWriters--}};
  }};
}}}
(async()=>{
  const root=directory();const file={id:'1',name:'a.pdf',paths:[['Folder']]};
  disk.set('root/Folder/a.pdf',{size:0});
  const manifest=await context.openDownloadManifest(root);
  let plan=await context.pendingDownloadTargets(root,file,()=>{},manifest);
  assert.equal(plan.length,1,'Empty placeholder is incomplete');
  await context.saveDownloadCopies(plan,file.name,{size:10},()=>false,()=>{}, {root,file,manifest,onStage:()=>{throw new Error('Unexpected stage')}});
  assert.equal(manifest.data.copies['Folder/a.pdf'].size,10);
  assert.equal((await context.pendingDownloadTargets(root,file,()=>{},manifest)).length,0,'Nonempty verified size skips before fetch');
  disk.set('root/Folder/a.pdf',{size:9});
  await assert.rejects(context.pendingDownloadTargets(root,file,()=>{},manifest),/differs from manifest/);
  disk.delete('root/Folder/a.pdf');
  assert.equal((await context.pendingDownloadTargets(root,file,()=>{},manifest)).length,1,'Stale manifest cannot skip missing file');
  activeWriters=0;maxWriters=0;
  await Promise.all([manifest.record('x.pdf','2',20),manifest.record('y.pdf','3',30)]);
  assert.equal(maxWriters,1,'Concurrent manifest updates serialized');
  const stored=JSON.parse(disk.get('root/.wrc-download-manifest.json'));
  assert.equal(stored.copies['x.pdf'].size,20);assert.equal(stored.copies['y.pdf'].size,30);
  const long={id:'4',name:'long.pdf',paths:[['Long']]};broken=true;let stages=0;
  plan=await context.pendingDownloadTargets(root,long,()=>{},manifest);
  await context.saveDownloadCopies(plan,long.name,{size:40},()=>false,()=>{throw new Error('Staged cannot report saved')},{root,file:long,manifest,onStage:()=>stages++});
  assert.equal(stages,1);
  const job=JSON.parse(disk.get('root/.wrc-recovery/4-0.job.json'));
  assert.equal(job.relativePath,'Long/long.pdf');assert.equal(job.size,40);
  assert(!manifest.data.copies['Long/long.pdf'],'Staging never marks final copy completed');
  assert.equal(disk.get('root/.wrc-recovery/4.bin').size,40);
  manifest.data.copies['Long/long.pdf']={id:'4',size:40,status:'completed',native:true};
  disk.set('root/Long/long.pdf',{size:40});disk.set('root/.wrc-download-manifest.json',JSON.stringify(manifest.data));
  const verified=await context.openDownloadManifest(root);
  assert.equal(verified.nativeCopies['Long/long.pdf'].size,40);
  assert.equal((await context.pendingDownloadTargets(root,long,()=>{},verified)).length,0,'Fresh helper verification skips long-path completed copy');
  disk.delete('root/Long/long.pdf');
  const removed=await context.openDownloadManifest(root);
  assert.equal((await context.pendingDownloadTargets(root,long,()=>{},removed)).length,1,'Fresh helper verification detects deleted native copy');
  console.log('Resume checks passed: zero files, missing/stale manifest, size mismatch preservation, serialized records, long-path staging without false completion.');
})().catch(error=>{console.error(error);process.exitCode=1});
