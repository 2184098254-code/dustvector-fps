/* DUSTVECTOR · renderer, input, sound and application states. All assets are local. */
(() => {
  'use strict';
  const Core = window.DustvectorCore;
  const $ = id => document.getElementById(id);
  const canvas = $('world');
  function showFatal(message){canvas.hidden=true;$('world-fallback').hidden=false;$('fatal-error').hidden=false;if(message)$('fatal-message').textContent=message;}
  const gl = canvas.getContext('webgl', { antialias: false, alpha: false, powerPreference: 'default', preserveDrawingBuffer: true });
  if (!gl || !Core) { showFatal(); return; }
  const game = new Core.Game();
  const touch = matchMedia('(any-pointer: coarse)').matches || navigator.maxTouchPoints > 0;
  let usingTouch = matchMedia('(pointer: coarse)').matches;
  document.documentElement.classList.toggle('touch-device', touch);
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  const clamp = Core.clamp;
  let hard = false, soundOn = true, audio = null, master = null, phase = 'menu';
  let keys = new Set(), firing = false, viewDrag = null, pointerPending = false;
  let lastFrame = performance.now(), visualTime = 0, recoil = 0, damage = 0, hitTime = 0, muzzle = 0, noticeUntil = 0;
  let bob = 0, stride = 0, best = 0, lastDraw = 0;
  const particles = [], tracers = [];
  const touchInput = new window.DustvectorTouch($('touch-controls'), $('joystick'), $('joystick-thumb'), {
    active: () => phase === 'playing', wake: () => initAudio(),
    look: (dx, dy) => { game.player.yaw -= dx; game.player.pitch = clamp(game.player.pitch - dy, -1.18, 1.18); }
  });
  try { touchInput.sensitivity = clamp(Number(localStorage.getItem('dustvector-look-sensitivity')) || 1, .5, 1.8); } catch { /* optional preference */ }
  $('look-sensitivity').value = touchInput.sensitivity;
  $('sensitivity-value').textContent = touchInput.sensitivity.toFixed(1) + '×';
  $('look-sensitivity').addEventListener('input', event => {
    touchInput.sensitivity = Number(event.target.value); $('sensitivity-value').textContent = touchInput.sensitivity.toFixed(1) + '×';
    try { localStorage.setItem('dustvector-look-sensitivity', String(touchInput.sensitivity)); } catch { /* optional preference */ }
  });
  try { best = Math.max(0, Number(localStorage.getItem('dustvector-best-v1')) || 0); soundOn = localStorage.getItem('dustvector-muted') !== '1'; } catch { /* storage is optional */ }
  $('best-score').textContent = String(best).padStart(4, '0');

  const hex = s => { const v = parseInt(s.replace('#', ''), 16); return [(v >> 16 & 255) / 255, (v >> 8 & 255) / 255, (v & 255) / 255]; };
  const C = { sand: hex('#f5dca5'), stone: hex('#79ccd2'), edge: hex('#fff0b6'), dark: hex('#ea9964'), charcoal: hex('#4d9da3'), metal: hex('#8ed7b5'), red: hex('#f3819f'), orange: hex('#ffcd58'), green: hex('#69b98a'), light: hex('#fff8df'), black: hex('#265e6a') };
  function perspective(fov, aspect, near = .08, far = 210) {
    const f = 1 / Math.tan(fov / 2), r = 1 / (near - far);
    return new Float32Array([f / aspect, 0, 0, 0, 0, f, 0, 0, 0, 0, (far + near) * r, -1, 0, 0, 2 * far * near * r, 0]);
  }
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const norm = a => { const d = Math.hypot(...a) || 1; return a.map(x => x / d); };
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  function lookAt(eye, target) {
    const z = norm(eye.map((v, i) => v - target[i])), x = norm(cross([0, 1, 0], z)), y = cross(z, x);
    return new Float32Array([x[0], y[0], z[0], 0, x[1], y[1], z[1], 0, x[2], y[2], z[2], 0, -dot(x, eye), -dot(y, eye), -dot(z, eye), 1]);
  }
  function multiply(a, b) {
    const out = new Float32Array(16);
    for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) out[c * 4 + r] = a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] + a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3];
    return out;
  }
  function model(x, y, z, sx = 1, sy = 1, sz = 1, yaw = 0, pitch = 0) {
    const c = Math.cos(yaw), s = Math.sin(yaw), a = Math.cos(pitch), b = Math.sin(pitch);
    return new Float32Array([c * sx, 0, -s * sx, 0, s * b * sy, a * sy, c * b * sy, 0, s * a * sz, -b * sz, c * a * sz, 0, x, y, z, 1]);
  }
  const identity = model(0, 0, 0);
  const vertex = `attribute vec3 aPosition,aNormal,aColor;attribute float aGlow;
    uniform mat4 uVP,uModel;varying mediump vec3 vWorld,vNormal,vColor;varying mediump float vGlow;
    void main(){vec4 w=uModel*vec4(aPosition,1.);vWorld=w.xyz;vNormal=normalize(mat3(uModel)*aNormal);vColor=aColor;vGlow=aGlow;gl_Position=uVP*w;}`;
  const fragment = `precision mediump float;varying mediump vec3 vWorld,vNormal,vColor;varying mediump float vGlow;
    uniform vec3 uEye;uniform float uFog,uDetail;
    void main(){vec3 n=normalize(vNormal);float sun=max(0.,dot(n,normalize(vec3(-.48,.82,.34))));
      float shade=sun>.62?1.04:(sun>.14?.94:.8);vec3 col=vColor*shade;
      if(uDetail>.5&&n.y>.95&&abs(vWorld.y)<.09){float ripple=sin(vWorld.x*.8+sin(vWorld.z*.55)*1.6)*sin(vWorld.z*1.2);col*=.98+ripple*.025;}
      col=mix(col,vColor*1.04,min(vGlow,1.));
      float d=length(vWorld-uEye);float fog=(1.-exp(-d*d*.00018))*uFog;col=mix(col,vec3(.29,.77,.79),fog);
      gl_FragColor=vec4(col,1.);}`;
  function compile(type, source) {
    const s = gl.createShader(type); gl.shaderSource(s, source); gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s)); return s;
  }
  function program(v, f) {
    const p = gl.createProgram(); gl.attachShader(p, compile(gl.VERTEX_SHADER, v)); gl.attachShader(p, compile(gl.FRAGMENT_SHADER, f)); gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p)); return p;
  }
  let shader, skyProgram;
  try {
    shader = program(vertex, fragment);
    skyProgram = program(`attribute vec2 aPosition;varying mediump vec2 vUV;void main(){vUV=aPosition;gl_Position=vec4(aPosition,1.,1.);}`,
      `precision mediump float;varying mediump vec2 vUV;uniform vec2 uSun;
       float flower(vec2 p){float r=length(p),a=atan(p.y,p.x);return 1.-smoothstep(.009,.019,abs(r-(.16+.045*cos(a*5.))));}
       void main(){float h=clamp(vUV.y*.5+.5,0.,1.);vec3 c=mix(vec3(.56,.88,.76),vec3(.19,.69,.82),h);
       float f=flower((vUV-vec2(.58,.5))*vec2(1.,1.15))+flower((vUV-vec2(-.58,.7))*1.3)+flower((vUV-vec2(.1,-.2))*1.6);
       c=mix(c,vec3(.24,.65,.72),clamp(f*.27,0.,.3));float rays=pow(max(0.,sin((vUV.x+vUV.y*.18)*12.)),14.);c+=vec3(.035,.055,.025)*rays*h;gl_FragColor=vec4(c,1.);}`);
  } catch (error) { showFatal('显卡未能编译场景，请更新浏览器或开启硬件加速。'); console.error(error); return; }
  const locations = {};
  for (const name of ['aPosition', 'aNormal', 'aColor', 'aGlow']) locations[name] = gl.getAttribLocation(shader, name);
  for (const name of ['uVP', 'uModel', 'uEye', 'uFog', 'uDetail']) locations[name] = gl.getUniformLocation(shader, name);
  const skyAttr = gl.getAttribLocation(skyProgram, 'aPosition'), skySun = gl.getUniformLocation(skyProgram, 'uSun');
  const skyBuffer = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, skyBuffer); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]), gl.STATIC_DRAW);
  const worldVertices = [], gunVertices = [];
  function face(out, points, normal, color, glow = 0) {
    for (const i of [0, 1, 2, 0, 2, 3]) out.push(...points[i], ...normal, ...color, glow);
  }
  function box(out, x, y, z, w, h, d, color, glow = 0, yaw = 0) {
    const a = w / 2, b = h / 2, c = d / 2, cos = Math.cos(yaw), sin = Math.sin(yaw);
    const p = (u, v, t) => [x + u * cos + t * sin, y + v, z - u * sin + t * cos];
    const n = (u, v, t) => [u * cos + t * sin, v, -u * sin + t * cos];
    face(out, [p(-a,-b,c),p(a,-b,c),p(a,b,c),p(-a,b,c)], n(0,0,1), color, glow);
    face(out, [p(a,-b,-c),p(-a,-b,-c),p(-a,b,-c),p(a,b,-c)], n(0,0,-1), color, glow);
    face(out, [p(a,-b,c),p(a,-b,-c),p(a,b,-c),p(a,b,c)], n(1,0,0), color, glow);
    face(out, [p(-a,-b,-c),p(-a,-b,c),p(-a,b,c),p(-a,b,-c)], n(-1,0,0), color, glow);
    face(out, [p(-a,b,c),p(a,b,c),p(a,b,-c),p(-a,b,-c)], n(0,1,0), color, glow);
    face(out, [p(-a,-b,-c),p(a,-b,-c),p(a,-b,c),p(-a,-b,c)], n(0,-1,0), color, glow);
  }
  function pyramid(out, x, y, z, w, h, d, color) {
    const pts = [[x-w/2,y,z-d/2],[x+w/2,y,z-d/2],[x+w/2,y,z+d/2],[x-w/2,y,z+d/2]], tip=[x,y+h,z];
    for (let i=0;i<4;i++) {const a=pts[i],b=pts[(i+1)%4],n=norm(cross(b.map((v,j)=>v-a[j]),tip.map((v,j)=>v-a[j])));for(const p of [a,tip,b])out.push(...p,...n,...color,0);}
  }
  function beam(out, from, to, width, color, glow = 0) {
    const d = to.map((v, i) => v - from[i]), dir = norm(d), right = norm(cross(Math.abs(dir[1]) > .95 ? [1,0,0] : [0,1,0], dir)), up = cross(dir, right);
    const pts = [];
    for (const p of [from,to]) for (const [a,b] of [[-1,-1],[1,-1],[1,1],[-1,1]]) pts.push(p.map((v,i)=>v+right[i]*width*a/2+up[i]*width*b/2));
    face(out,[pts[0],pts[1],pts[5],pts[4]],up.map(v=>-v),color,glow);
    face(out,[pts[1],pts[2],pts[6],pts[5]],right,color,glow);
    face(out,[pts[2],pts[3],pts[7],pts[6]],up,color,glow);
    face(out,[pts[3],pts[0],pts[4],pts[7]],right.map(v=>-v),color,glow);
  }
  function ellipsoid(out,x,y,z,rx,ry,rz,color,glow=0,segments=10,rings=6){
    const point=(a,b)=>{const s=Math.sin(b),c=Math.cos(b),u=Math.cos(a),v=Math.sin(a);return {p:[x+rx*s*u,y+ry*c,z+rz*s*v],n:norm([s*u/rx,c/ry,s*v/rz])};};
    for(let j=0;j<rings;j++)for(let i=0;i<segments;i++){
      const a=i/segments*Math.PI*2,b=(i+1)/segments*Math.PI*2,c=j/rings*Math.PI,d=(j+1)/rings*Math.PI;
      const points=[point(a,c),point(b,c),point(b,d),point(a,d)];
      for(const k of [0,1,2,0,2,3])out.push(...points[k].p,...points[k].n,...color,glow);
    }
  }
  function softBox(out,x,y,z,w,h,d,color,r=.18){
    r=Math.min(r,w*.24,h*.24,d*.24);
    const ring=(yy,inset)=>{
      const a=w/2-inset,b=d/2-inset,rad=Math.max(.01,r-inset),points=[];
      for(const [cx,cz,start]of[[a-rad,b-rad,0],[-a+rad,b-rad,Math.PI/2],[-a+rad,-b+rad,Math.PI],[a-rad,-b+rad,Math.PI*1.5]])
        for(let i=0;i<=2;i++){const angle=start+i*Math.PI/4;points.push([x+cx+Math.cos(angle)*rad,yy,z+cz+Math.sin(angle)*rad]);}
      return points;
    };
    const rows=[ring(y-h/2,r*.8),ring(y-h/2+r,0),ring(y+h/2-r,0),ring(y+h/2,r*.8)];
    for(let row=0;row<3;row++)for(let i=0;i<12;i++){
      const next=(i+1)%12,p=rows[row][i],q=rows[row][next],t=rows[row+1][next];
      const n=norm(cross(q.map((v,k)=>v-p[k]),t.map((v,k)=>v-p[k])));
      face(out,[p,q,t,rows[row+1][i]],n,color);
    }
    for(const index of [0,3])for(let i=0;i<12;i++){
      const n=[0,index===3?1:-1,0];for(const p of [[x,rows[index][0][1],z],rows[index][i],rows[index][(i+1)%12]])out.push(...p,...n,...color,0);
    }
  }
  function floorDecal(x,z,w,d,color){box(worldVertices,x,.018,z,w,.015,d,color);}
  const B=(...args)=>box(worldVertices,...args),S=(...args)=>ellipsoid(worldVertices,...args),R=(...args)=>softBox(worldVertices,...args);
  B(0,-.22,0,200,.44,200,C.sand);
  // The unchanged collision footprint now belongs to a small underwater village.
  const chestColors=[hex('#f2a8a5'),hex('#a1d6b5'),hex('#edb856'),hex('#f3c1a3')];
  Core.COLLIDERS.forEach((b,i)=>{
    if(i<4){R(b.x,b.y,b.z,b.w,b.h,b.d,hex(i%2?'#7cced1':'#8dd8c9'),.35);return;}
    if(i===4){
      R(b.x,b.y,b.z,b.w,b.h,b.d,hex('#f2ba55'),.65);
      S(0,8.4,-7,2.65,1.5,2.65,hex('#f1b24f'));
      for(let row=0;row<6;row++)for(let col=0;col<4;col++){
        const x=-1.8+col*1.2+(row%2?.35:0);if(x>2.1)continue;
        S(x,1.3+row*1.2,-4.485,.16,.24,.035,hex('#d99b42'),0,6,4);
      }
      for(let i=0;i<7;i++){const a=i/7*Math.PI*2;pyramid(worldVertices,Math.sin(a)*1.2,9.5,-7+Math.cos(a)*1.2,1,3+i%2,1,hex(i%2?'#67b76f':'#86c16d'));}
      R(0,1.5,-4.35,1.55,2.8,.32,C.black,.45);
      S(0,2.4,-4.15,.43,.43,.07,hex('#b6eddf'));S(.47,1.3,-4.12,.09,.09,.06,C.orange,0,6,4);
      for(const x of[-1.25,1.25]){S(x,5.45,-4.37,.66,.66,.17,C.light);S(x,5.45,-4.18,.46,.46,.05,hex('#5ca6ba'));S(x-.14,5.6,-4.1,.13,.16,.03,C.light,0,6,4);}
    }else if(i===5){
      R(b.x,b.y,b.z,b.w,b.h,b.d,hex('#f3a8a4'),.6);
      R(b.x,b.y+b.h/2+.3,b.z,b.w+.5,.8,b.d+.5,hex('#7dc3c0'),.35);
      R(-15.9,2,-4,.3,3.6,2.1,C.black,.4);
      for(const z of[-9.7,.6]){S(-15.9,4.8,z,.15,.82,.82,C.light);S(-15.72,4.8,z,.06,.6,.6,hex('#62b8c8'));}
      R(-14.5,4.25,-4,3.1,.28,5.6,hex('#f7df94'),.12);
      for(let i=0;i<7;i++)B(-14.5,4.41,-6.5+i*.78,3.05,.06,.36,i%2?hex('#fbf4d4'):hex('#ef9297'));
      for(const z of[-6.5,-1.5])R(-13.1,2,z,.18,4,.18,C.light,.06);
      S(-19,8.4,-5,1.2,.9,1.2,hex('#f1d579'));
    }else if(i===6){
      R(b.x,b.y,b.z,b.w,b.h,b.d,hex('#83c4d7'),1);
      S(b.x,8.6,b.z,5,1.2,5,hex('#73b4ca'));
      R(17,1.8,-11.9,2.2,3.6,.3,hex('#3a9ca7'),.6);
      for(const x of[14.6,19.4]){S(x,5.9,-11.92,.85,.85,.16,C.edge);S(x,5.9,-11.72,.62,.62,.06,hex('#438eaa'));}
      for(let i=0;i<3;i++)R(17,9.8+i*.5,-17,3-i*.65,.25,3-i*.65,hex('#afd3b8'),.1);
    }else{
      const col=chestColors[(i-7)%chestColors.length];R(b.x,b.y,b.z,b.w,b.h,b.d,col,.24);
      R(b.x,b.y+b.h*.3,b.z,b.w+.08,.2,b.d+.08,C.light,.07);
      B(b.x,b.y,b.z+b.d/2+.03,b.w-.25,.08,.04,hex('#79ada2'));
      R(b.x,b.y+.04,b.z+b.d/2+.1,.44,.5,.16,hex('#e8b940'),.08);
      S(b.x,b.y+.05,b.z+b.d/2+.2,.06,.08,.025,C.black,0,6,4);
    }
  });
  // Small scallops, branching coral and seaweed give the arena its own setting.
  const rng=Core.seededRandom(7081);
  function coral(x,z,color,size=1){
    const trunk=[x,.1,z],top=[x,2.1*size,z];beam(worldVertices,trunk,top,.24*size,color);
    for(const side of[-1,1]){const bend=[x+side*.7*size,1.1*size,z],tip=[x+side*.75*size,1.8*size,z];beam(worldVertices,[x,.8*size,z],bend,.22*size,color);beam(worldVertices,bend,tip,.22*size,color);S(...tip,.16*size,.2*size,.16*size,color,0,6,4);}
    S(...top,.2*size,.2*size,.2*size,color,0,6,4);
  }
  for(const[x,z,s]of[[-22,16,1.2],[22,8,1.5],[-14,-21,1.4],[8,-22,1.1],[21,-8,1.3],[-22,3,1.1]])coral(x,z,hex('#ed8f9e'),s);
  for(let i=0;i<16;i++){
    const side=i%2?1:-1,x=side*(22.3+rng()*.4),z=-22+i*2.8;
    for(let k=0;k<3;k++)beam(worldVertices,[x+k*.25,.1,z],[x+Math.sin(k*2)*.5,.7+rng()*1.7,z+.2],.14,hex(k%2?'#69af84':'#8bc185'));
  }
  for(let i=0;i<34;i++){
    const x=(rng()-.5)*45,z=(rng()-.5)*45;if(Core.occupied(x,z,.8,1)||Math.abs(x)<3)continue;
    S(x,.08,z,.16+rng()*.18,.08,.12+rng()*.14,hex(i%2?'#f9eed0':'#eebeb0'),0,6,3);
  }
  for(let i=0;i<18;i++){const a=i/18*Math.PI*2,r=56+rng()*25;S(Math.sin(a)*r,-.5,Math.cos(a)*r,8+rng()*8,7+rng()*12,8+rng()*7,hex(i%2?'#79c7c6':'#a0d5bd'),0,9,5);}
  // A friendly sponge-shaped bubble bottle with a round nozzle and soft fins.
  const G=(...args)=>softBox(gunVertices,...args),GS=(...args)=>ellipsoid(gunVertices,...args);
  G(.23,-.25,-.5,.24,.23,.6,hex('#f6d965'),.07);
  G(.23,-.31,-.26,.15,.25,.18,hex('#64b6b6'),.05);
  GS(.23,-.2,-.7,.17,.17,.21,hex('#8cd6c5'));
  GS(.23,-.2,-.87,.14,.14,.06,C.edge);GS(.23,-.2,-.921,.095,.095,.018,hex('#4d9cac'));
  G(.23,-.1,-.47,.19,.09,.23,hex('#eb9ca2'),.035);
  GS(.36,-.26,-.4,.014,.045,.045,hex('#b28d3c'),0,6,4);
  GS(.36,-.25,-.56,.014,.04,.04,hex('#b28d3c'),0,6,4);
  GS(.14,-.16,-.28,.035,.035,.018,C.black,0,6,4);GS(.27,-.16,-.28,.035,.035,.018,C.black,0,6,4);
  G(.29,-.42,-.12,.19,.16,.31,hex('#fff2c7'),.06);G(.1,-.4,-.62,.16,.14,.25,hex('#fff2c7'),.06);
  function upload(vertices, usage=gl.STATIC_DRAW){const b=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,b);gl.bufferData(gl.ARRAY_BUFFER,new Float32Array(vertices),usage);return {buffer:b,count:vertices.length/10};}
  const worldMesh=upload(worldVertices),gunMesh=upload(gunVertices);
  // Keep the muzzle geometry alive between frames; deleting a bound mesh leaves
  // vertex attributes pointing at a missing buffer for the next background pass.
  const muzzleVertices=[];
  ellipsoid(muzzleVertices,.23,-.2,-1.03,.105,.105,.13,hex('#e1ffff'),.6,7,5);
  const muzzleMesh=upload(muzzleVertices);
  const sceneAttributeLocations=['aPosition','aNormal','aColor','aGlow'].map(name=>locations[name]);
  const dynamicMesh={buffer:gl.createBuffer(),count:0};
  function bind(mesh){
    gl.bindBuffer(gl.ARRAY_BUFFER,mesh.buffer);
    for(const [name,size,offset] of [['aPosition',3,0],['aNormal',3,12],['aColor',3,24],['aGlow',1,36]]){const l=locations[name];gl.enableVertexAttribArray(l);gl.vertexAttribPointer(l,size,gl.FLOAT,false,40,offset);}
  }
  function draw(mesh,matrix=identity){gl.uniformMatrix4fv(locations.uModel,false,matrix);bind(mesh);gl.drawArrays(gl.TRIANGLES,0,mesh.count);}
  function addDrone(out,e,time){
    const body=e.flash>0?C.light:hex(e.id%2?'#f3a2b3':'#f1ba88');
    ellipsoid(out,e.x,e.y+.14,e.z,.75,.57,.7,body);
    ellipsoid(out,e.x,e.y-.13,e.z,.78,.18,.72,hex('#fae0c5'),0,10,4);
    const angle=Math.atan2(game.player.x-e.x,game.player.z-e.z),c=Math.cos(angle),s=Math.sin(angle);
    for(const side of[-1,1]){
      const x=e.x+side*.25*c+.59*s,z=e.z-side*.25*s+.59*c;
      ellipsoid(out,x,e.y+.11,z,.17,.22,.13,C.light,0,7,5);
      ellipsoid(out,x+s*.105,e.y+.09,z+c*.105,.075,.11,.06,C.black,0,6,4);
    }
    for(let i=0;i<5;i++){
      const a=i/5*Math.PI*2,px=e.x+Math.sin(a)*.46,pz=e.z+Math.cos(a)*.46;
      const bend=[px+Math.sin(time*3+i)*.12,e.y-.5,pz],tip=[px+Math.sin(time*3+i+.7)*.2,e.y-.94,pz];
      beam(out,[px,e.y-.17,pz],bend,.09,body);beam(out,bend,tip,.075,body);
    }
  }
  function render(now){
    const w=canvas.width,h=canvas.height;gl.viewport(0,0,w,h);gl.clearColor(.4,.45,.4,1);gl.clear(gl.COLOR_BUFFER_BIT|gl.DEPTH_BUFFER_BIT);
    gl.disable(gl.DEPTH_TEST);gl.useProgram(skyProgram);
    // The background has a different vertex layout from scene and effect meshes.
    for(const location of sceneAttributeLocations)if(location!==skyAttr)gl.disableVertexAttribArray(location);
    gl.bindBuffer(gl.ARRAY_BUFFER,skyBuffer);gl.enableVertexAttribArray(skyAttr);gl.vertexAttribPointer(skyAttr,2,gl.FLOAT,false,0,0);gl.uniform2f(skySun,.54,.62);gl.drawArrays(gl.TRIANGLES,0,6);
    gl.useProgram(shader);gl.enable(gl.DEPTH_TEST);gl.depthFunc(gl.LEQUAL);gl.disable(gl.CULL_FACE);
    let eye,target;
    if(phase==='menu'||phase==='help') {eye=[18,5.4,22];target=[-3,4.8,-7];}
    else {const p=game.player,cp=Math.cos(p.pitch+recoil*.22);eye=[p.x,p.y+(reduced.matches?0:Math.sin(bob)*stride*.026),p.z];target=[p.x-Math.sin(p.yaw)*cp,eye[1]+Math.sin(p.pitch+recoil*.22),p.z-Math.cos(p.yaw)*cp];}
    const view=lookAt(eye,target),projection=perspective((phase==='playing'&&keys.has('ShiftLeft')?80:75)*Math.PI/180,w/h);
    gl.uniformMatrix4fv(locations.uVP,false,multiply(projection,view));gl.uniform3fv(locations.uEye,eye);gl.uniform1f(locations.uFog,1);gl.uniform1f(locations.uDetail,1);draw(worldMesh);
    const v=[];
    const drones=phase==='menu'||phase==='help'?[{x:5.5,y:2.9,z:5,id:1,flash:0},{x:-5,y:4.3,z:-13,id:2,flash:0},{x:15,y:3.3,z:-5,id:3,flash:0}]:game.enemies;
    for(const e of drones)addDrone(v,e,now);
    for(const b of game.projectiles)ellipsoid(v,b.x,b.y,b.z,.2,.2,.2,C.red,.4,6,4);
    for(const p of game.pickups){
      const y=.45+(reduced.matches?0:Math.sin(now*2+p.id)*.06),color=p.kind==='health'?C.green:C.orange;
      softBox(v,p.x,y,p.z,.75,.65,.65,color,.1);box(v,p.x,y+.34,p.z,.8,.06,.7,C.light,.2);
      box(v,p.x,y,p.z+.34,.38,.09,.02,color,.6);if(p.kind==='health')box(v,p.x,y,p.z+.35,.09,.38,.02,color,.6);
      else for(let j=0;j<3;j++)box(v,p.x-.14+j*.14,y,p.z+.35,.06,.26,.02,color,.7);
    }
    for(const p of particles)box(v,p.x,p.y,p.z,p.size,p.size,p.size,p.color,p.glow||0,p.life*5);
    for(const t of tracers)beam(v,t.from,t.to,.016,C.light,1);
    if(v.length){gl.bindBuffer(gl.ARRAY_BUFFER,dynamicMesh.buffer);gl.bufferData(gl.ARRAY_BUFFER,new Float32Array(v),gl.DYNAMIC_DRAW);dynamicMesh.count=v.length/10;gl.uniform1f(locations.uDetail,0);draw(dynamicMesh);}
    if(phase!=='menu'&&phase!=='help'){
      gl.clear(gl.DEPTH_BUFFER_BIT);gl.uniformMatrix4fv(locations.uVP,false,perspective(65*Math.PI/180,w/h,.03,8));gl.uniform3fv(locations.uEye,[0,0,0]);gl.uniform1f(locations.uFog,0);gl.uniform1f(locations.uDetail,0);
      const reloadAngle=game.reloadTime>0?Math.sin((1-game.reloadTime/1.65)*Math.PI):0;
      const sway=reduced.matches?0:Math.sin(bob)*stride*.008;
      const portrait=w/h<.8,weaponScale=portrait?.85:1;
      const weaponMatrix=model((portrait?-.09:.025)+sway,(portrait?-.14:-.055)-Math.abs(sway)-reloadAngle*.29,(portrait?-.38:-.12)+recoil*.17,weaponScale,weaponScale,weaponScale,reloadAngle*-.45,recoil*.22+reloadAngle*.55);
      draw(gunMesh,weaponMatrix);
      if(muzzle>0)draw(muzzleMesh,weaponMatrix);
    }
  }
  function resize(){const width=Math.max(1,canvas.clientWidth),height=Math.max(1,canvas.clientHeight),ratio=Math.min(devicePixelRatio||1,touch?1.15:1.5,Math.sqrt((touch?1000000:1800000)/(width*height)));canvas.width=Math.round(width*ratio);canvas.height=Math.round(height*ratio);if(touch)touchInput.reset();render(visualTime);}
  addEventListener('resize',resize);
  window.visualViewport?.addEventListener('resize',resize);
  canvas.addEventListener('webglcontextlost',e=>{e.preventDefault();if(phase==='playing')pause();showFatal('图形上下文已中断，请重新加载游戏。');});

  // Web Audio uses locally synthesized sounds, activated by the first user gesture.
  function initAudio(){
    try {if(!audio){audio=new(window.AudioContext||window.webkitAudioContext)();master=audio.createGain();master.gain.value=soundOn?.24:0;master.connect(audio.destination);}if(audio.state==='suspended')audio.resume().catch(()=>{});}catch{/* game remains playable without audio */}
  }
  function tone(freq,duration,type='sine',gain=.2,end=freq){
    if(!audio||!soundOn||audio.state!=='running')return;
    const o=audio.createOscillator(),g=audio.createGain(),t=audio.currentTime;o.type=type;o.frequency.setValueAtTime(freq,t);o.frequency.exponentialRampToValueAtTime(Math.max(20,end),t+duration);g.gain.setValueAtTime(gain,t);g.gain.exponentialRampToValueAtTime(.001,t+duration);o.connect(g);g.connect(master);o.start(t);o.stop(t+duration);
  }
  function shotSound(){
    tone(720,.11,'sine',.24,240);tone(1180,.045,'triangle',.09,780);
  }
  function updateSoundButton(){const b=$('sound-btn');b.classList.toggle('muted-sound',!soundOn);b.setAttribute('aria-label',soundOn?'关闭声音':'开启声音');b.setAttribute('aria-pressed',String(!soundOn));}
  $('sound-btn').onclick=()=>{initAudio();soundOn=!soundOn;if(master)master.gain.value=soundOn?.24:0;try{localStorage.setItem('dustvector-muted',soundOn?'0':'1');}catch{}updateSoundButton();};updateSoundButton();
  $('fullscreen-btn').onclick=async()=>{try{if(document.fullscreenElement)await document.exitFullscreen();else await document.documentElement.requestFullscreen();}catch{showNotice('浏览器未允许全屏\n你仍可以在当前窗口游玩',2500);}};
  $('fullscreen-btn').hidden = !document.fullscreenEnabled;
  document.addEventListener('fullscreenchange',()=>{$('fullscreen-btn').setAttribute('aria-label',document.fullscreenElement?'退出全屏':'进入全屏');resize();});

  function showNotice(text,duration=2200){$('notice').textContent=text;$('notice').classList.add('visible');noticeUntil=performance.now()+duration;}
  function clearInput(){keys.clear();firing=false;viewDrag=null;touchInput.reset();}
  function setPhase(next){
    phase=next;document.body.classList.toggle('playing',next==='playing');document.body.classList.toggle('overlay-open',next==='paused'||next==='won'||next==='lost');
    $('menu').hidden=next!=='menu';$('hud').hidden=next!=='playing';$('help-screen').hidden=next!=='help';
    $('pause-screen').hidden=next!=='paused';$('result-screen').hidden=next!=='won'&&next!=='lost';$('touch-controls').hidden=next!=='playing'||!usingTouch;
    $('nav-state').textContent=next==='playing'?'泡泡小队，出动！':next==='paused'?'小队休息中':next==='won'?'小镇守护成功':next==='lost'?'补充活力再来一次':'海底冒险，准备出发';
    clearInput();render(visualTime);
  }
  async function captureMouse(){
    if(usingTouch)return;
    try{pointerPending=true;const result=canvas.requestPointerLock();if(result&&result.catch)await result.catch(()=>{});}catch{/* drag-to-look and arrow keys are available */}finally{pointerPending=false;}
  }
  function start(event){usingTouch=event?.pointerType==='touch'||(!event?.pointerType&&matchMedia('(pointer: coarse)').matches);initAudio();game.start(hard);particles.length=0;tracers.length=0;damage=0;recoil=0;hitTime=0;muzzle=0;setPhase('playing');canvas.focus({preventScroll:true});captureMouse();processEvents();updateHUD();lastFrame=performance.now();}
  function pause(){if(phase!=='playing')return;game.state='paused';setPhase('paused');if(document.pointerLockElement===canvas)document.exitPointerLock();$('resume-btn').focus({preventScroll:true});}
  function resume(){if(phase!=='paused')return;initAudio();game.state='playing';setPhase('playing');canvas.focus({preventScroll:true});captureMouse();lastFrame=performance.now();}
  function menu(){game.state='menu';if(document.pointerLockElement===canvas)document.exitPointerLock();game.enemies=[];game.projectiles=[];game.pickups=[];particles.length=0;tracers.length=0;$('notice').classList.remove('visible');setPhase('menu');$('start-btn').focus({preventScroll:true});}
  function finish(won){
    setPhase(won?'won':'lost');if(document.pointerLockElement===canvas)document.exitPointerLock();
    $('result-eyebrow').textContent=won?'泡泡小队 · 守护成功':'泡泡小队 · 冒险结束';$('result-title').textContent=won?'水母都回家啦':'先喝杯海盐汽水';
    $('result-description').textContent=won?'三波挑战完成，今天的小镇又恢复热闹了。':'活力用完啦。记得利用小箱子挡住水母的泡泡。';
    $('result-score').textContent=game.score;$('result-kills').textContent=game.kills;$('result-accuracy').textContent=(game.shots?Math.round(game.hits/game.shots*100):0)+'%';
    $('result-time').textContent=Math.floor(game.time/60)+':'+String(Math.floor(game.time%60)).padStart(2,'0');
    const record=game.score>best;if(record){best=game.score;try{localStorage.setItem('dustvector-best-v1',String(best));}catch{}}$('best-score').textContent=String(best).padStart(4,'0');
    $('result-record').textContent=record?'本地最佳纪录已更新 · '+best+' 分':'本地最高纪录 · '+best+' 分';
    // Re-mount the original dealt counter moment on the actual, freshly calculated results.
    const old=$('result-stats'),fresh=old.cloneNode(true);fresh.removeAttribute('data-moment-ready');fresh.removeAttribute('data-moment-mounted');old.replaceWith(fresh);
    window.dispatchEvent(new CustomEvent('dustvector-results',{detail:{previous:old}}));
    tone(won?440:150,.6,'triangle',.3,won?880:55);$('retry-btn').focus({preventScroll:true});
  }
  $('start-btn').onclick=start;$('retry-btn').onclick=start;$('pause-btn').onclick=pause;$('resume-btn').onclick=resume;$('quit-btn').onclick=menu;$('result-menu-btn').onclick=menu;
  function closeHelp(){setPhase('menu');$('help-btn').focus({preventScroll:true});}
  $('help-btn').onclick=()=>{setPhase('help');$('close-help-btn').focus({preventScroll:true});};$('close-help-btn').onclick=closeHelp;$('help-ready-btn').onclick=closeHelp;
  for(const [id,value]of[['normal-btn',false],['hard-btn',true]])$(id).onclick=()=>{hard=value;for(const [bid,v]of[['normal-btn',false],['hard-btn',true]]){$(bid).classList.toggle('selected',v===hard);$(bid).setAttribute('aria-pressed',String(v===hard));}};
  document.addEventListener('pointerlockchange',()=>{if(document.pointerLockElement!==canvas&&phase==='playing'&&!pointerPending)pause();});
  document.addEventListener('pointerlockerror',()=>{if(phase==='playing')showNotice('鼠标未锁定：按住画面拖动瞄准\n也可使用方向键环视',3500);});
  document.addEventListener('visibilitychange',()=>{if(document.hidden&&phase==='playing')pause();});
  addEventListener('blur',()=>{if(phase==='playing')pause();});
  addEventListener('keydown',e=>{
    if(['Space','ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(e.code)&&phase==='playing')e.preventDefault();
    if(e.code==='Escape'||e.code==='KeyP'){
      if(e.repeat)return;
      if(phase==='playing')pause();else if(phase==='paused')resume();else if(phase==='help')closeHelp();return;
    }
    if(phase==='help'&&e.code==='Tab'){
      const first=$('close-help-btn'),last=$('help-ready-btn');if(e.shiftKey&&document.activeElement===first){e.preventDefault();last.focus();}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first.focus();}return;
    }
    if(phase!=='playing')return;keys.add(e.code);if(e.code==='KeyR')game.reload();
  });
  addEventListener('keyup',e=>keys.delete(e.code));
  document.addEventListener('mousemove',e=>{
    if(phase!=='playing')return;
    if(document.pointerLockElement===canvas){game.player.yaw-=e.movementX*.0023;game.player.pitch=clamp(game.player.pitch-e.movementY*.0023,-1.18,1.18);}
    else if(viewDrag){game.player.yaw-=(e.clientX-viewDrag.x)*.004;game.player.pitch=clamp(game.player.pitch-(e.clientY-viewDrag.y)*.004,-1.18,1.18);viewDrag={x:e.clientX,y:e.clientY};}
  });
  canvas.addEventListener('mousedown',e=>{if(phase!=='playing'||e.button!==0)return;initAudio();firing=true;if(document.pointerLockElement!==canvas)viewDrag={x:e.clientX,y:e.clientY};});
  addEventListener('mouseup',()=>{firing=false;viewDrag=null;});
  canvas.addEventListener('contextmenu',e=>e.preventDefault());
  $('touch-reload').onclick=()=>game.reload();
  $('touch-reload').addEventListener('pointerdown', event => { if (event.pointerType !== 'mouse') { event.preventDefault(); game.reload(); } });
  $('pause-btn').addEventListener('pointerdown', event => { if (event.pointerType !== 'mouse') { event.preventDefault(); pause(); } });
  $('touch-controls').addEventListener('contextmenu', event => event.preventDefault());

  function burst(x,y,z,color,count=12,force=2){for(let i=0;i<count;i++)particles.push({x,y,z,vx:(Math.random()-.5)*force,vy:Math.random()*force,vz:(Math.random()-.5)*force,life:.3+Math.random()*.5,size:.025+Math.random()*.07,color,glow:count>15?.45:0});}
  function processEvents(){
    for(const e of game.drainEvents())switch(e.type){
      case 'shot':{
        recoil=Math.min(.16,recoil+.075);muzzle=.045;shotSound();
        const p=game.player,s=Math.sin(p.yaw),c=Math.cos(p.yaw);tracers.push({from:[p.x+c*.22-s*.7,p.y-.17,p.z-s*.22-c*.7],to:[e.end.x,e.end.y,e.end.z],life:.04});break;}
      case 'hit':hitTime=.16;$('hit-marker').classList.remove('kill');tone(450,.055,'triangle',.13,700);break;
      case 'kill':hitTime=.3;$('hit-marker').classList.add('kill');burst(e.x,e.y,e.z,C.red,18,2.6);tone(520,.2,'sine',.18,1100);break;
      case 'impact':burst(e.x,e.y,e.z,C.edge,5,1.5);break;
      case 'damage':damage=.6;tone(230,.12,'sine',.25,140);break;
      case 'reload':tone(340,.1,'square',.08,200);break;
      case 'reloaded':tone(540,.09,'square',.07,300);break;
      case 'noReserve':showNotice('泡泡不够啦 · 去找黄色补给箱',2200);break;
      case 'wave':showNotice('第 '+e.wave+' 波水母来啦\n赶走 '+e.count+' 只捣蛋水母',2300);tone(280,.18,'sine',.18,420);break;
      case 'waveClear':showNotice('第 '+e.wave+' 波挑战完成\n活力 +20 · 泡泡 +48',3200);tone(440,.25,'sine',.2,660);break;
      case 'pickup':showNotice(e.kind==='health'?'喝口汽水 · 活力 +35':'装满泡泡 · 储备 +36',1600);tone(550,.12,'sine',.14,880);break;
      case 'enemyShot':if(Math.hypot(game.player.x-e.x,game.player.z-e.z)<12)tone(250,.1,'triangle',.04,100);break;
      case 'won':finish(true);break;case 'lost':finish(false);break;
    }
  }
  const radar=$('radar').getContext('2d');
  function updateRadar(){
    const ctx=radar,w=144,c=72,scale=2.25,p=game.player;ctx.clearRect(0,0,w,w);ctx.save();ctx.translate(c,c);
    ctx.strokeStyle='#387c6d30';ctx.lineWidth=1;for(const r of [24,48,68]){ctx.beginPath();ctx.arc(0,0,r,0,Math.PI*2);ctx.stroke();}
    ctx.beginPath();ctx.moveTo(-68,0);ctx.lineTo(68,0);ctx.moveTo(0,-68);ctx.lineTo(0,68);ctx.stroke();
    ctx.save();ctx.beginPath();ctx.arc(0,0,68,0,Math.PI*2);ctx.clip();ctx.rotate(-p.yaw);ctx.translate(-p.x*scale,-p.z*scale);
    ctx.fillStyle='#5da99b80';for(const b of Core.COLLIDERS)ctx.fillRect((b.x-b.w/2)*scale,(b.z-b.d/2)*scale,b.w*scale,b.d*scale);
    ctx.fillStyle='#b54b6d';for(const e of game.enemies){ctx.beginPath();ctx.arc(e.x*scale,e.z*scale,2.7,0,Math.PI*2);ctx.fill();}
    ctx.fillStyle='#cf9a22';for(const i of game.pickups)ctx.fillRect(i.x*scale-2,i.z*scale-2,4,4);ctx.restore();
    ctx.fillStyle='#174e50';ctx.beginPath();ctx.moveTo(0,-6);ctx.lineTo(-4,4);ctx.lineTo(0,2);ctx.lineTo(4,4);ctx.closePath();ctx.fill();ctx.restore();
  }
  function updateHUD(){
    const p=game.player;$('health-value').textContent=Math.ceil(p.hp);$('health-fill').style.width=p.hp+'%';$('health-fill').style.background=p.hp<30?'#df7282':'#57a97e';$('health-label').textContent=p.hp<30?'找绿色箱子补活力':'活力满满';
    $('ammo-value').textContent=String(game.ammo).padStart(2,'0');$('ammo-value').style.color=game.ammo<6?'#a44954':'';$('reserve-value').textContent=game.reserve;
    $('wave-value').textContent=String(game.wave).padStart(2,'0');$('remaining-value').textContent=game.waveDelay>0?'水母正在集合':'还剩 '+game.enemies.length+' 只';$('score-value').textContent=String(game.score).padStart(4,'0');
    document.querySelectorAll('.wave-progress i').forEach((e,i)=>e.classList.toggle('active',i<game.wave));
    let degrees=((p.yaw*180/Math.PI)%360+360)%360;degrees=(360-degrees)%360;const dirs=['N','NE','E','SE','S','SW','W','NW'];$('compass').textContent=dirs[Math.round(degrees/45)%8]+'   · · ·   '+String(Math.round(degrees)).padStart(3,'0')+'   · · ·';
    $('reload-notice').hidden=game.reloadTime<=0;$('reload-fill').style.width=(1-game.reloadTime/1.65)*100+'%';updateRadar();
  }
  let hudClock=0;
  function frame(now){
    const dt=Math.min((now-lastFrame)/1000,.05);lastFrame=now;
    if(phase==='playing'){
      const input={forward:(keys.has('KeyW')?1:0)-(keys.has('KeyS')?1:0)-touchInput.y,strafe:(keys.has('KeyD')?1:0)-(keys.has('KeyA')?1:0)+touchInput.x,
        turn:(keys.has('ArrowLeft')?1:0)-(keys.has('ArrowRight')?1:0),look:(keys.has('ArrowUp')?1:0)-(keys.has('ArrowDown')?1:0),sprint:keys.has('ShiftLeft')||keys.has('ShiftRight')||touchInput.sprint,fire:firing||keys.has('Space')||touchInput.fire};
      game.update(dt,input);processEvents();visualTime+=dt;recoil*=Math.exp(-dt*19);muzzle=Math.max(0,muzzle-dt);damage=Math.max(0,damage-dt*1.6);hitTime=Math.max(0,hitTime-dt);
      stride+=(Math.min(1,Math.hypot(input.forward,input.strafe))-stride)*Math.min(1,dt*10);bob+=dt*(input.sprint?16:11);
      for(let i=particles.length-1;i>=0;i--){const p=particles[i];p.life-=dt;p.x+=p.vx*dt;p.y+=p.vy*dt;p.z+=p.vz*dt;p.vy-=dt*6;if(p.life<=0||p.y<.02)particles.splice(i,1);}
      for(let i=tracers.length-1;i>=0;i--){tracers[i].life-=dt;if(tracers[i].life<=0)tracers.splice(i,1);}
      $('damage-vignette').style.opacity=damage;$('hit-marker').style.opacity=hitTime>0?'1':'0';$('crosshair').classList.toggle('firing',game.fireCooldown>.065);
      if(now>noticeUntil)$('notice').classList.remove('visible');
      hudClock+=dt;if(hudClock>.08){hudClock=0;updateHUD();}if(!touch||now-lastDraw>=1000/40){render(visualTime);lastDraw=now;}
    }
    requestAnimationFrame(frame);
  }
  // Read-only state is useful for accessibility helpers and browser smoke tests.
  window.Dustvector=Object.freeze({getState:()=>({phase,wave:game.wave,health:game.player.hp,ammo:game.ammo,reserve:game.reserve,enemies:game.enemies.length,kills:game.kills,score:game.score,time:game.time,position:{x:game.player.x,y:game.player.y,z:game.player.z},view:{yaw:game.player.yaw,pitch:game.player.pitch},targets:game.enemies.map(e=>({x:e.x,y:e.y,z:e.z,hp:e.hp})),pointerLocked:document.pointerLockElement===canvas,hard,touch:{enabled:usingTouch,moveX:touchInput.x,moveY:touchInput.y,firing:touchInput.fire,pointers:touchInput.pointers.size,sensitivity:touchInput.sensitivity}})});
  resize();document.documentElement.dataset.ready='1';requestAnimationFrame(frame);
})();
