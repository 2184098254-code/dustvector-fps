/* Mobile input regression checks in one foreground headless Chrome, scoped to its own process and profile. */
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),{spawn,execFileSync}=require('node:child_process'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..'),profile=path.join(root,'.taste-skill','chrome-render-regression'),results=[],exceptions=[];
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
    const proto=WebGLRenderingContext.prototype,draw=proto.drawArrays,create=proto.createBuffer,remove=proto.deleteBuffer;
    window.renderProbe={sky:[],errors:[],created:0,deleted:0};
    proto.createBuffer=function(){window.renderProbe.created++;return create.call(this);};
    proto.deleteBuffer=function(buffer){window.renderProbe.deleted++;return remove.call(this,buffer);};
    proto.drawArrays=function(...args){
      const probe=window.renderProbe,program=this.getParameter(this.CURRENT_PROGRAM),sky=this.getProgramParameter(program,this.ACTIVE_ATTRIBUTES)===1;
      draw.apply(this,args);const error=this.getError();
      if(error)probe.errors.push({stage:sky?'background':'scene',error,frame:probe.sky.length});
      if(sky){
        const pixel=new Uint8Array(4);this.readPixels(Math.floor(this.drawingBufferWidth*.25),Math.floor(this.drawingBufferHeight*.8),1,1,this.RGBA,this.UNSIGNED_BYTE,pixel);
        probe.sky.push({rgb:Array.from(pixel),error});
      }
    };
  })()`});
  const key=async(down)=>S('Input.dispatchKeyEvent',{type:down?'keyDown':'keyUp',code:'Space',key:' ',windowsVirtualKeyCode:32});
  for(const[width,height,mobile]of[[1024,768,false],[390,844,true],[844,390,true]]){
    await load('index.html',width,height,mobile);
    await tap('#start-btn');await waitFor(async()=>(await state()).phase==='playing','game starts');
    const idleFrames=(await ev('window.renderProbe.sky.length'));
    await waitFor(async()=>(await ev('window.renderProbe.sky.length'))>idleFrames+5,'background baseline');
    const baseline=await ev('window.renderProbe.sky.at(-1).rgb');
    await ev('window.renderProbe.sky=[];window.renderProbe.errors=[];window.renderProbe.created=0;window.renderProbe.deleted=0;');
    const ammo=(await state()).ammo;
    if(mobile){const p=await ev("(()=>{const r=document.getElementById('touch-fire').getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()");await S('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{...p,id:9}]});}
    else await key(true);
    await waitFor(async()=>ammo-(await state()).ammo>=10,'ten consecutive shots',20000);
    if(mobile)await S('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});else await key(false);
    const atRelease=await ev('window.renderProbe.sky.length');
    await waitFor(async()=>(await ev('window.renderProbe.sky.length'))>atRelease+8,'frames after trigger released');
    const probe=await ev('window.renderProbe'),bad=probe.sky.filter(frame=>frame.rgb.some((v,i)=>Math.abs(v-baseline[i])>1));
    const detail={width,height,frames:probe.sky.length,backgroundErrors:probe.errors.filter(x=>x.stage==='background').length,sceneErrors:probe.errors.filter(x=>x.stage==='scene').length,changedBackgroundFrames:bad.length,baseline,example:bad[0]?.rgb,createdBuffersDuringFire:probe.created,deletedBuffersDuringFire:probe.deleted};
    console.log('RENDER_SAMPLE',JSON.stringify(detail));
    fs.mkdirSync(path.join(root,'shots'),{recursive:true});fs.writeFileSync(path.join(root,'shots',`render-${width}x${height}.json`),JSON.stringify({detail,probe},null,2));
    assert.equal(probe.errors.length,0,'all render passes must be valid while firing');
    assert.equal(bad.length,0,'background pixels must stay unchanged across muzzle-effect frames');
    assert.equal(probe.created,0,'shooting should reuse GPU meshes');assert.equal(probe.deleted,0,'shooting should not delete GPU meshes');
    report('Stable background while firing '+width+'x'+height,detail);
  }
  assert.equal(exceptions.length,0,exceptions.join('\n'));report('No browser exceptions');
  fs.writeFileSync(path.join(root,'shots','render-regression.json'),JSON.stringify({status:'PASS',results,exceptions},null,2));
}
function cleanup(){clearTimeout(timer);try{ws?.close();}catch{}if(child&&child.exitCode===null){try{execFileSync('taskkill',['/PID',String(child.pid),'/T','/F'],{stdio:'ignore'});}catch{try{child.kill();}catch{}}}server.close();}
main().catch(error=>{console.error(error);fs.mkdirSync(path.join(root,'shots'),{recursive:true});fs.writeFileSync(path.join(root,'shots','render-regression.json'),JSON.stringify({status:'FAIL',results,exceptions,error:String(error.stack)},null,2));process.exitCode=1;}).finally(cleanup);
