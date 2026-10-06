const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const source = fs.readFileSync(__dirname + '/wrc-bulk-uploader.user.js', 'utf8');
const fragment = source.slice(source.indexOf('  function startDownloadView'), source.indexOf("  const SCRIPT_VERSION"));
const context = vm.createContext({location:{pathname:'/home',href:'https://westminster.cadetnet.mod.uk/app/r/westminster/resource_centre/manage-documents',origin:'https://westminster.cadetnet.mod.uk'}, URL, Map, Set, Array, console, setTimeout, clearTimeout, AbortController, Date});
vm.runInContext(fragment.slice(fragment.indexOf('  function startDownloadView')),context);
const cell = (text,href) => ({textContent:text,querySelector:()=>href ? {getAttribute:()=>href} : null});
const row = (id,name,options={}) => ({hidden:!!options.hidden,getAttribute:()=>null,getClientRects:()=>[{}],querySelectorAll:()=>[cell(name),cell('',options.url || '?ai_download_file_id='+id)]});
const report = rows => ({querySelectorAll:()=>[{querySelector:()=>({querySelectorAll:()=>[cell('File Name'),cell('Download')]}),querySelectorAll:()=>[{},...rows]}]});
// APEX renders the sticky header as a separate matching table before the data.
const dataReport = report(Array.from({length:65},(_,i)=>row(String(i+100),'CFI_'+i+'.pdf')));
context.report={querySelectorAll:()=>[...report([]).querySelectorAll(),...dataReport.querySelectorAll(),...dataReport.querySelectorAll()]};
assert.equal(vm.runInContext('collectDisplayedDownloads(report).length',context),65,'Skip header-only tables and deduplicate cloned report rows');
context.report = report([row('10','a.pdf'),row('10','a.pdf'),row('11','b.docx',{hidden:true}),row('12','c.pdf',{url:'https://other.test/?ai_download_file_id=12'})]);
assert.equal(vm.runInContext('collectDisplayedDownloads(report).length',context),1);
context.report=report([row('10','../a.pdf')]);
assert.throws(()=>vm.runInContext('collectDisplayedDownloads(report)',context),/safely/);
context.report=report([row('10','CON.pdf')]);
assert.throws(()=>vm.runInContext('collectDisplayedDownloads(report)',context),/safely/);
context.report=report([row('10','same.pdf'),row('11','same.pdf')]);
assert.equal(vm.runInContext('collectDisplayedDownloads(report).length',context),2);

(async()=>{
  context.folder={getFileHandle:async()=>{throw Object.assign(new Error(),{name:'NotFoundError'})}};
  assert.equal(await vm.runInContext("downloadFileExists(folder,'a.pdf')",context),false);
  context.folder={getFileHandle:async()=>{throw Object.assign(new Error(),{name:'NotAllowedError'})}};
  await assert.rejects(vm.runInContext("downloadFileExists(folder,'a.pdf')",context),{name:'NotAllowedError'});
  const elements={};
  const element=()=>({style:{},textContent:'',disabled:false,value:'1',children:[],appendChild(item){this.children.push(item)},replaceChildren(){this.children=[]}});
  const saved=[];
  const disk=new Map();
  function directory(path='batch'){
    return {name:path,async getDirectoryHandle(name){return directory(path+'/'+name)},async getFileHandle(name,options){
      const key=path+'/'+name;
      if(!options?.create && !disk.has(key)) throw Object.assign(new Error(),{name:'NotFoundError'});
      if(options?.create) disk.set(key,true);
      return {async createWritable(){return {async write(blob){assert.equal(blob.size,4)},async close(){saved.push(key)},async abort(){}}}};
    }};
  }
  const document={body:{appendChild(){}},createElement(){const item=element();item.querySelector=selector=>elements[selector] ||= element();return item},querySelectorAll:()=>context.report.querySelectorAll()};
  context.document=document;
  context.window={showDirectoryPicker:async()=>directory()};
  let active=0,maxActive=0;
  context.fetch=async()=>{active++;maxActive=Math.max(active,maxActive);return {ok:true,redirected:false,async blob(){active--;return {size:4,type:'application/pdf'}}}};
  vm.runInContext('startDownloadView()',context);
  await elements['#wrc-dl-folder'].onclick();
  await elements['#wrc-dl-start'].onclick();
  assert.deepEqual(saved,['batch/WRC-10/same.pdf','batch/WRC-11/same.pdf']);
  assert.equal(maxActive,1);
  await elements['#wrc-dl-start'].onclick();
  assert.equal(saved.length,2,'Existing files must not be overwritten');
  context.report=report([row('20','auth.pdf'),row('21','later.pdf')]);
  let requests=0;
  context.fetch=async()=>{requests++;return {ok:true,redirected:false,async blob(){return {size:50,type:'text/html'}}}};
  await elements['#wrc-dl-start'].onclick();
  assert.equal(requests,1,'Login HTML must stop the run');
  assert.equal(saved.length,2,'Login HTML must not be written');
  assert.equal(elements['#wrc-dl-start'].disabled,false);
  context.fetch=async()=>{
    elements['#wrc-dl-stop'].onclick();
    return {ok:true,redirected:false,async blob(){return {size:4,type:'application/pdf'}}};
  };
  await elements['#wrc-dl-start'].onclick();
  assert.equal(saved.length,2,'Stopping an active download must prevent saving its response');
  assert.match(elements['#wrc-dl-status'].textContent,/Stopped/);
  console.log('Download checks passed: report scope, deduplication, unsafe names, duplicate names, permission errors, chosen folder, sequential requests, overwrite protection, and login response stop.');
})().catch(error=>{console.error(error);process.exitCode=1});
