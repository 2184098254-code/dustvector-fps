/* Mobile input regression checks in one foreground headless Chrome, scoped to its own process and profile. */
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),{spawn,execFileSync}=require('node:child_process'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..'),profile=path.join(root,'.taste-skill','chrome-safari-activation'),results=[],exceptions=[];
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const mime={'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.svg':'image/svg+xml','.jpg':'image/jpeg','.woff2':'font/woff2'};
const server=http.createServer((req,res)=>{try{const file=path.resolve(root,'.'+decodeURIComponent(new URL(req.url,'http://localhost').pathname));if(!file.startsWith(root+path.sep))throw new Error();const stat=fs.statSync(file),f=stat.isDirectory()?path.join(file,'index.html'):file;res.writeHead(200,{'Content-Type':mime[path.extname(f)]||'application/octet-stream'});fs.createReadStream(f).pipe(res);}catch{res.writeHead(404);res.end();}});
let child,ws,timer;
async function main(){
  await new Promise(r=>server.listen(0,'127.0.0.1',r));
  fs.mkdirSync(profile,{recursive:true});const portFile=path.join(profile,'DevToolsActivePort');try{fs.unlinkSync(portFile);}catch{}
  const candidates=[process.env.CHROME_PATH,'C:/Program Files/Google/Chrome/Application/chrome.exe','C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe','/usr/bin/google-chrome','/usr/bin/chromium'];
  const executable=candidates.find(p=>p&&fs.existsSync(p));assert.ok(executable,'A Chromium browser is installed');
  child=spawn(executable,['--headless=new',`--user-data-dir=${profile}`,'--remote-debugging-port=0','--no-first-run','--no-default-browser-check','--disable-extensions','--disable-gpu','--use-angle=swiftshader','--enable-unsafe-swiftshader','--mute-audio','--hide-scrollbars','about:blank'],{stdio:'ignore',windowsHide:true});
  timer=setTimeout(()=>{console.error('Browser smoke timeout');cleanup();process.exit(2);},240000);
  let port;for(let i=0;i<150&&!port;i++){await sleep(100);try{port=Number(fs.readFileSync(portFile,'utf8').split('\n')[0]);}catch{}}
  assert.ok(port,'Chrome DevTools is ready');const version=await(await fetch(`http://127.0.0.1:${port}/json/version`,{signal:AbortSignal.timeout(5000)})).json();
  ws=new WebSocket(version.webSocketDebuggerUrl);await new Promise((r,j)=>{ws.addEventListener('open',r,{once:true});ws.addEventListener('error',j,{once:true});});
  let id=0;const pending=new Map();ws.addEventListener('message',event=>{const m=JSON.parse(event.data);if(m.id&&pending.has(m.id)){const p=pending.get(m.id);pending.delete(m.id);clearTimeout(p.timer);m.error?p.reject(new Error(m.error.message)):p.resolve(m.result);}else if(m.method==='Runtime.exceptionThrown')exceptions.push(m.params.exceptionDetails.exception?.description||m.params.exceptionDetails.text);});
  const send=(method,params={},sessionId)=>new Promise((resolve,reject)=>{const n=++id,timer=setTimeout(()=>{pending.delete(n);reject(new Error('CDP timeout: '+method));},25000);pending.set(n,{resolve,reject,timer});ws.send(JSON.stringify({id:n,method,params,sessionId}));});
  const {targetId}=await send('Target.createTarget',{url:'about:blank'}),{sessionId}=await send('Target.attachToTarget',{targetId,flatten:true});
  const S=(m,p)=>send(m,p,sessionId),ev=async expression=>{const r=await S('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)throw new Error(r.exceptionDetails.exception?.description||r.exceptionDetails.text);return r.result.value;};
  await S('Page.enable');await S('Runtime.enable');
  const state=()=>ev('Dustvector.getState()');
  const waitFor=async(fn,label,max=15000)=>{const start=Date.now();while(Date.now()-start<max){if(await fn())return;await sleep(100);}throw new Error('Timed out: '+label);};
  const report=(name,detail)=>{results.push({name,status:'PASS',detail});console.log('PASS '+name+' '+(detail?JSON.stringify(detail):''));};
  const shot=async name=>{const {data}=await S('Page.captureScreenshot',{format:'png'});fs.mkdirSync(path.join(root,'shots'),{recursive:true});fs.writeFileSync(path.join(root,'shots',name+'.png'),Buffer.from(data,'base64'));};
  const load=async(file,width=1440,height=900,mobile=false)=>{await S('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile});await S('Emulation.setTouchEmulationEnabled',{enabled:mobile,maxTouchPoints:5});await S('Page.navigate',{url:`http://127.0.0.1:${server.address().port}/${file}`});await waitFor(()=>ev('Boolean(window.Dustvector&&document.documentElement.dataset.ready)'),file+' ready');await sleep(900);};
  const tap=async selector=>{const p=await ev(`(()=>{const r=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`);await S('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{...p,id:4}]});await S('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await sleep(120);};
  await S('Page.addScriptToEvaluateOnNewDocument',{source:`(()=>{
    window.activationTrace=[];
    document.addEventListener('pointerdown',event=>{if(event.target.closest('#start-btn'))window.activationTrace.push({event:'pointerdown',type:event.pointerType});},true);
    document.addEventListener('click',event=>{
      if(!event.target.closest('#start-btn,#retry-btn,#resume-btn'))return;
      // Emulate a compatibility click labeled "mouse" after a real touch press.
      Object.defineProperty(event,'pointerType',{value:'mouse'});
      window.activationTrace.push({event:'click',type:event.pointerType});
    },true);
  })()`});
  await load('index.html',390,844,true);
  await tap('#start-btn');
  const activated=await state(),visible=await ev("!document.getElementById('touch-controls').hidden");
  console.log('SAFARI_ACTIVATION',JSON.stringify({phase:activated.phase,touchEnabled:activated.touch.enabled,controlsVisible:visible,events:await ev('window.activationTrace')}));
  assert.equal(activated.phase,'playing');
  assert.equal(visible,true,'a touch activation must show controls even when Safari labels click as mouse');
  assert.equal(activated.touch.enabled,true);
  const points=[{x:70,y:420,id:1}];
  await S('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:points});
  await S('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:70,y:350,id:1}]});
  const position=activated.position;
  await waitFor(async()=>Math.hypot((await state()).position.x-position.x,(await state()).position.z-position.z)>.03,'Safari activation movement');
  const fire=await ev("(()=>{const r=document.getElementById('touch-fire').getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2,id:2}})()"),ammo=(await state()).ammo;
  await S('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:70,y:350,id:1},fire]});
  await waitFor(async()=>(await state()).ammo<ammo,'Safari activation firing');
  await S('Input.dispatchTouchEvent',{type:'touchCancel',touchPoints:[]});
  await tap('#pause-btn');await waitFor(async()=>(await state()).phase==='paused','pause');await tap('#resume-btn');
  assert.equal((await state()).touch.enabled,true);assert.equal(await ev("!document.getElementById('touch-controls').hidden"),true);
  await ev(`(()=>{const original=DustvectorCore.Game.prototype.update;DustvectorCore.Game.prototype.update=function(...args){DustvectorCore.Game.prototype.update=original;this.damage(150);original.apply(this,args);};})()`);
  await waitFor(async()=>(await state()).phase==='lost','end round');await tap('#retry-btn');
  assert.equal((await state()).phase,'playing');assert.equal((await state()).touch.enabled,true);
  assert.equal(await ev("!document.getElementById('touch-controls').hidden"),true);
  assert.equal(exceptions.length,0,exceptions.join('\n'));
  report('Safari mislabeled click still supports movement, firing, resume and retry');
  fs.mkdirSync(path.join(root,'shots'),{recursive:true});fs.writeFileSync(path.join(root,'shots','safari-activation.json'),JSON.stringify({status:'PASS',results,exceptions},null,2));
}
function cleanup(){clearTimeout(timer);try{ws?.close();}catch{}if(child&&child.exitCode===null){try{execFileSync('taskkill',['/PID',String(child.pid),'/T','/F'],{stdio:'ignore'});}catch{try{child.kill();}catch{}}}server.close();}
main().catch(error=>{console.error(error);fs.mkdirSync(path.join(root,'shots'),{recursive:true});fs.writeFileSync(path.join(root,'shots','safari-activation.json'),JSON.stringify({status:'FAIL',results,exceptions,error:String(error.stack)},null,2));process.exitCode=1;}).finally(cleanup);
