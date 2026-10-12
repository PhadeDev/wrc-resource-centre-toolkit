const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const source=fs.readFileSync(__dirname+'/wrc-bulk-uploader.user.js','utf8');
const context=vm.createContext({Date,setTimeout,Map,Set,Array});
vm.runInContext(source.slice(source.indexOf('  function readDownloadSpeed'),source.indexOf('  function parseDownloadCsv')),context);
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
for(const pair of [[0,1],[9,1],[1.5,1],[1,-1],[1,61],['',1],[1,''],[1,'bad']]) assert.throws(()=>context.readDownloadSpeed(...pair),/concurrency/);
assert.equal(context.readDownloadSpeed(8,0).concurrency,8);
assert.equal(context.readDownloadSpeed(1,0.1).delay,0.1);
assert.equal(context.safeDownloadRetryAfter('60'),'60 seconds');
assert.equal(context.safeDownloadRetryAfter('not a date'),null);
assert.equal(context.safeDownloadRetryAfter('Mon, 12 Oct 2026 12:00:00 GMT'),'2026-10-12T12:00:00.000Z');
assert(!context.downloadLogError(new Error('https://signed.example/file?token=secret session=secret')).includes('secret'));
(async()=>{
  let active=0,max=0;const seen=[];
  await context.runDownloadPool([1,2,3,4,5,6],()=>({concurrency:3,delay:0}),async file=>{
    active++;max=Math.max(max,active);seen.push(file);await wait(170);active--;
  },()=>false,()=>{});
  assert.equal(max,3);assert.deepEqual(seen,[1,2,3,4,5,6]);assert.equal(active,0);
  const starts=[];
  await context.runDownloadPool([1,2,3],()=>({concurrency:3,delay:0.12}),async()=>{starts.push(Date.now());await wait(170)},()=>false,()=>{});
  assert(starts[1]-starts[0]>=120 && starts[2]-starts[1]>=120,'Start gap applies globally, not separately per worker');
  let cap=3;let running=0;const launched=[];
  await context.runDownloadPool([1,2,3,4,5],()=>({concurrency:cap,delay:0}),async file=>{
    running++;launched.push([file,running]);if(file===3)cap=1;await wait(180);running--;
  },()=>false,()=>{});
  assert(launched.filter(([id])=>id>=4).every(([,n])=>n===1),'Live decrease waits for active jobs to finish');
  let stopped=false;const stoppedSeen=[];
  await context.runDownloadPool([1,2,3],()=>({concurrency:2,delay:0}),async file=>{stoppedSeen.push(file);stopped=true;await wait(20)},()=>stopped,()=>{});
  assert.deepEqual(stoppedSeen,[1],'Stop launches no further jobs');
  let invalid=false,halted=false,finished=false;
  await assert.rejects(context.runDownloadPool([1,2],()=>{if(invalid)throw new Error('bad speed');return {concurrency:2,delay:0}},async()=>{invalid=true;await wait(120);finished=true},()=>false,()=>{},()=>{halted=true}),/bad speed/);
  assert(halted && finished,'Invalid live settings halt launching and drain active jobs before returning');
  let workerHalted=false;
  await assert.rejects(context.runDownloadPool([1,2],()=>({concurrency:2,delay:0}),async()=>{throw new Error('worker failed')},()=>false,()=>{},()=>{workerHalted=true}),/worker failed/);
  assert(workerHalted);
  console.log('Speed checks passed: concurrency cap, global fractional start gap, live decrease, Stop, invalid settings, draining failures, log redaction, Retry-After.');
})().catch(error=>{console.error(error);process.exitCode=1});
