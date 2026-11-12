/* Mobile input regression checks in one foreground headless Chrome, scoped to its own process and profile. */
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),{spawn,execFileSync}=require('node:child_process'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..'),profile=path.join(root,'.taste-skill','chrome-mobile-regression'),results=[],exceptions=[];
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
  {
    const sendTouches=(type,points)=>S('Input.dispatchTouchEvent',{type,touchPoints:points.map(p=>({...p,radiusX:5,radiusY:5,force:1}))});
    const center=selector=>ev(`(()=>{const r=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`);
    for(const[width,height]of[[390,844],[390,664],[320,568],[844,390],[932,430]]){
      await load('index.html',width,height,true);
      const geometry=await ev(`(()=>{const r=document.getElementById('start-btn').getBoundingClientRect(),h=document.getElementById('hero-h').getBoundingClientRect();return {overflow:document.documentElement.scrollWidth>innerWidth,start:r.bottom<=innerHeight-4&&r.top>=0,heading:h.top>=0&&h.right<=innerWidth,height:document.getElementById('arena').clientHeight,viewport:innerHeight}})()`);
      assert.equal(geometry.overflow,false);assert.equal(geometry.start,true,'start button visible at '+width+'x'+height);assert.equal(geometry.heading,true);assert.equal(geometry.height,height);report('Mobile layout '+width+'x'+height,geometry);
      if(width===390&&height===844){await shot('ocean-mobile-menu');await tap('#help-btn');await ev("document.getElementById('look-sensitivity').value='1.4';document.getElementById('look-sensitivity').dispatchEvent(new Event('input',{bubbles:true}))");await tap('#help-ready-btn');assert.equal((await state()).touch.sensitivity,1.4);report('Turn sensitivity changes and is retained');}
      await tap('#start-btn');assert.equal((await state()).phase,'playing');if(width===390&&height===844){await waitFor(()=>ev("!document.getElementById('notice').classList.contains('visible')"),'wave notice settles');await shot('ocean-mobile-game');}if(width===844){await waitFor(()=>ev("!document.getElementById('notice').classList.contains('visible')"),'landscape notice settles');await shot('ocean-landscape-game');}
      const fire=await center('#touch-fire'),reload=await center('#touch-reload');
      const layout=await ev(`(()=>{const a=document.getElementById('touch-fire').getBoundingClientRect(),b=document.querySelector('.ammo-block').getBoundingClientRect(),p=document.getElementById('pause-btn').getBoundingClientRect();return {fireVisible:a.x>=0&&a.right<=innerWidth&&a.bottom<=innerHeight,pauseReachable:document.elementFromPoint(p.x+p.width/2,p.y+p.height/2).closest('button')?.id==='pause-btn',controlsDoNotCoverAmmo:a.bottom<b.top,fireTarget:document.elementFromPoint(a.x+a.width/2,a.y+a.height/2).closest('button')?.id}})()`);
      assert.equal(layout.fireVisible,true);assert.equal(layout.pauseReachable,true);assert.equal(layout.controlsDoNotCoverAmmo,true);assert.equal(layout.fireTarget,'touch-fire');
      const move={x:Math.round(width*.16),y:Math.round(height*.47),id:1},left={...move,y:move.y-58};
      const before=await state();await sendTouches('touchStart',[move]);await sendTouches('touchMove',[left]);
      const right={...fire,id:2};await sendTouches('touchStart',[left,right]);await sendTouches('touchMove',[left,{...right,x:right.x-30,y:right.y-20}]);
      await waitFor(async()=> (await state()).ammo<before.ammo,'two thumb firing',10000);
      await waitFor(async()=>Math.abs((await state()).view.yaw-before.view.yaw)>.05,'right thumb changes view');const during=await state();assert.equal(during.touch.pointers,2);assert.equal(during.touch.firing,true);assert.ok(during.touch.moveY<0);assert.ok(Math.abs(during.view.yaw-before.view.yaw)>.05);assert.ok(Math.abs(during.view.pitch-before.view.pitch)>.03);
      await waitFor(async()=>Math.hypot((await state()).position.x-before.position.x,(await state()).position.z-before.position.z)>.03,'movement while firing');
      await sendTouches('touchMove',[left,{...right,x:width*.59,y:height*.3}]);assert.equal((await state()).touch.firing,true);report('Move + aim + fire and drag outside button '+width+'x'+height);
      await sendTouches('touchEnd',[{...right,x:width*.59,y:height*.3}]);await waitFor(async()=>!(await state()).touch.firing,'fire finger release');assert.equal((await state()).touch.firing,false);assert.ok((await state()).touch.moveY<0);
      await sendTouches('touchCancel',[]);await waitFor(async()=>(await state()).touch.pointers===0,'pointer cancellation');assert.equal((await state()).touch.pointers,0);assert.equal((await state()).touch.moveY,0);report('Finger release and cancellation reset '+width+'x'+height);
      const ammo=(await state()).ammo;await tap('#touch-reload');await waitFor(async()=> (await state()).ammo===24,'mobile refill');report('Refill touch button '+width+'x'+height);
      if(width===390&&height===844)await shot('ocean-mobile-inputs');
      if(width===844)await shot('ocean-landscape-inputs');
      await sendTouches('touchStart',[move]);await sendTouches('touchMove',[left]);
      const pause=await center('#pause-btn');await sendTouches('touchStart',[left,{...pause,id:5}]);await sendTouches('touchEnd',[]);await waitFor(async()=>(await state()).phase==='paused','pause while moving');assert.equal((await state()).phase,'paused');assert.equal((await state()).touch.pointers,0);report('Pause with another finger held '+width+'x'+height);
      await tap('#resume-btn');assert.equal((await state()).phase,'playing');assert.equal((await state()).touch.moveY,0);
      await sendTouches('touchStart',[move]);await sendTouches('touchMove',[left]);
      await S('Emulation.setDeviceMetricsOverride',{width:height,height:width,deviceScaleFactor:1,mobile:true});await waitFor(async()=> (await state()).touch.pointers===0,'rotation releases controls');report('Orientation change clears input '+width+'x'+height);await sendTouches('touchCancel',[]);
    }
    await load('index.html',844,390,true);
    await ev("document.documentElement.style.setProperty('--safe-left','44px');document.documentElement.style.setProperty('--safe-right','44px');document.documentElement.style.setProperty('--safe-bottom','21px')");
    await tap('#start-btn');const safe=await ev(`(()=>{const r=document.getElementById('touch-fire').getBoundingClientRect(),h=document.querySelector('.health-block').getBoundingClientRect();return {right:innerWidth-r.right,bottom:innerHeight-r.bottom,healthLeft:h.left}})()`);assert.ok(safe.right>=44);assert.ok(safe.bottom>=21);assert.ok(safe.healthLeft>=44);report('Landscape notch and home-indicator insets',safe);
    assert.equal(exceptions.length,0,exceptions.join('\n'));report('No browser exceptions');
    fs.writeFileSync(path.join(root,'shots','mobile-regression.json'),JSON.stringify({status:'PASS',results,exceptions},null,2));return;
  }

}
function cleanup(){clearTimeout(timer);try{ws?.close();}catch{}if(child&&child.exitCode===null){try{execFileSync('taskkill',['/PID',String(child.pid),'/T','/F'],{stdio:'ignore'});}catch{try{child.kill();}catch{}}}server.close();}
main().catch(error=>{console.error(error);fs.mkdirSync(path.join(root,'shots'),{recursive:true});fs.writeFileSync(path.join(root,'shots','mobile-regression.json'),JSON.stringify({status:'FAIL',results,exceptions,error:String(error.stack)},null,2));process.exitCode=1;}).finally(cleanup);
