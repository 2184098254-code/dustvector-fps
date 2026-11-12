/* DUSTVECTOR · renderer, input, sound and application states. All assets are local. */
(() => {
  'use strict';
  const Core = window.DustvectorCore;
  const $ = id => document.getElementById(id);
  const canvas = $('world');
  function showFatal(message){canvas.hidden=true;$('world-fallback').hidden=false;$('fatal-error').hidden=false;if(message)$('fatal-message').textContent=message;}
  const gl = canvas.getContext('webgl', { antialias: true, alpha: false, powerPreference: 'high-performance', preserveDrawingBuffer: true });
  if (!gl || !Core) { showFatal(); return; }
  const game = new Core.Game();
  const touch = matchMedia('(pointer: coarse)').matches;
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  const clamp = Core.clamp;
  let hard = false, soundOn = true, audio = null, master = null, phase = 'menu';
  let keys = new Set(), firing = false, viewDrag = null, pointerPending = false;
  let lastFrame = performance.now(), visualTime = 0, recoil = 0, damage = 0, hitTime = 0, muzzle = 0, noticeUntil = 0;
  let bob = 0, stride = 0, best = 0, zoom = 0, lastDraw = 0;
  const particles = [], tracers = [];
  const joystick = { x: 0, y: 0, id: null }, lookTouch = { id: null, x: 0, y: 0 };
  try { best = Math.max(0, Number(localStorage.getItem('dustvector-best-v1')) || 0); soundOn = localStorage.getItem('dustvector-muted') !== '1'; } catch { /* storage is optional */ }
  $('best-score').textContent = String(best).padStart(4, '0');

  const hex = s => { const v = parseInt(s.replace('#', ''), 16); return [(v >> 16 & 255) / 255, (v >> 8 & 255) / 255, (v & 255) / 255]; };
  const C = { sand: hex('#ac9470'), stone: hex('#b19d7d'), edge: hex('#c7b38d'), dark: hex('#343b37'), charcoal: hex('#222c2c'), metal: hex('#60685c'), red: hex('#b52e28'), orange: hex('#e99b55'), green: hex('#92ab7b'), light: hex('#f2ddae'), black: hex('#111a1c') };
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
    uniform mat4 uVP,uModel;varying vec3 vWorld,vNormal,vColor;varying float vGlow;
    void main(){vec4 w=uModel*vec4(aPosition,1.);vWorld=w.xyz;vNormal=normalize(mat3(uModel)*aNormal);vColor=aColor;vGlow=aGlow;gl_Position=uVP*w;}`;
  const fragment = `precision highp float;varying vec3 vWorld,vNormal,vColor;varying float vGlow;
    uniform vec3 uEye;uniform float uFog,uDetail;
    float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
    void main(){vec3 n=normalize(vNormal);float sun=max(0.,dot(n,normalize(vec3(-.48,.82,.34))));
      float light=.49+sun*.58;vec3 col=vColor*light;
      if(uDetail>.5&&vGlow<.1){float grain=hash(floor(vWorld.xz*35.)+floor(vWorld.xy*31.));col*=.965+grain*.07;
        if(n.y>.95&&abs(vWorld.y)<.09){vec2 g=abs(fract(vWorld.xz/3.)-.5);float line=max(smoothstep(.492,.5,g.x),smoothstep(.492,.5,g.y));col*=1.-line*.19;
          float tile=hash(floor(vWorld.xz/3.));col*=.94+tile*.11;}
        else if(abs(n.y)<.3){float row=floor(vWorld.y/1.25);vec2 p=vec2(abs(n.x)>.5?vWorld.z:vWorld.x,vWorld.y);p.x+=mod(row,2.)*1.45;
          vec2 g=abs(fract(p/vec2(2.9,1.25))-.5);float mortar=max(smoothstep(.495,.5,g.x),smoothstep(.493,.5,g.y));col*=1.-mortar*.13;}}
      col=mix(col,vColor*(1.1+vGlow*.2),min(vGlow,1.));
      float d=length(vWorld-uEye);float fog=(1.-exp(-d*d*.00013))*uFog;col=mix(col,vec3(.58,.61,.55),fog);
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
    skyProgram = program(`attribute vec2 aPosition;varying vec2 vUV;void main(){vUV=aPosition;gl_Position=vec4(aPosition,1.,1.);}`,
      `precision mediump float;varying vec2 vUV;uniform vec2 uSun;void main(){float h=clamp(vUV.y*.5+.5,0.,1.);vec3 c=mix(vec3(.67,.68,.57),vec3(.25,.37,.39),pow(h,.65));float s=length((vUV-uSun)*vec2(1.5,1.));c+=vec3(.48,.36,.18)*exp(-s*5.);c=mix(c,vec3(1.,.88,.62),1.-smoothstep(.035,.042,s));gl_FragColor=vec4(c,1.);}`);
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
  function floorDecal(x,z,w,d,color){box(worldVertices,x,.018,z,w,.015,d,color);}
  const B = (...args) => box(worldVertices, ...args);
  // Architecture: the same collision boxes drive the visuals, ray occlusion and radar.
  B(0,-.2,0,200,.4,200,C.sand);
  Core.COLLIDERS.forEach((b,i)=> {
    const color=i<4?C.stone:i===4?C.dark:i<7?C.stone:C.charcoal;
    B(b.x,b.y,b.z,b.w,b.h,b.d,color);
    if(i<7)B(b.x,b.y+b.h/2+.12,b.z,b.w+.25,.24,b.d+.25,i===4?C.charcoal:C.edge);
    if(i>=7){
      B(b.x,b.y+b.h/2+.03,b.z,b.w+.07,.09,b.d+.07,C.metal);
      for(const side of [-1,1]) { B(b.x+side*(b.w/2-.18),b.y,b.z+b.d/2+.025,.12,b.h,.04,C.metal); B(b.x,b.y,b.z+side*(b.d/2+.025),b.w-.5,.12,.04,C.metal); }
      B(b.x,b.y+.2,b.z+b.d/2+.05,.65,.27,.04,C.orange);
    }
    if(i>3){
      const shadowWidth=b.w+Math.min(b.h*.7,5),shadowDepth=b.d+Math.min(b.h*.45,4);
      floorDecal(b.x+Math.min(b.h*.35,2.5),b.z-Math.min(b.h*.22,2),shadowWidth,shadowDepth,hex('#8c7a60'));
    }
  });
  // Relay tower: an open antenna silhouette, glowing signal spine, service ladders.
  B(0,10.1,-7,3.6,1.6,3.6,C.charcoal); B(0,11.15,-7,4.8,.4,4.8,C.edge);
  B(0,13.6,-7,.28,4.8,.28,C.metal);B(0,16.1,-7,.42,.18,.42,C.red,1);
  for(let i=0;i<4;i++){B(0,12+i*.85,-7,3.4-i*.55,.11,.13,C.charcoal);B(0,12+i*.85,-7,.13,.11,3.4-i*.55,C.charcoal);}
  for(const x of [-1.4,1.4])for(const z of [-8.4,-5.6]){B(x,8.3,z,.12,5.4,.12,C.metal);beam(worldVertices,[x,6,z],[x*-1,10.9,z],.07,C.metal);}
  B(0,5.2,-4.47,.3,6.9,.06,C.orange,.75);B(-1.5,4.2,-4.46,.12,6.8,.08,C.charcoal);B(-.85,4.2,-4.46,.12,6.8,.08,C.charcoal);
  for(let i=0;i<20;i++)B(-1.175,.65+i*.34,-4.39,.75,.06,.08,C.metal);
  B(.9,3.2,-4.42,1.5,1.1,.16,C.black);B(.9,3.25,-4.31,1.15,.1,.04,C.orange,1);B(.9,2.95,-4.3,.7,.05,.04,C.green,.5);
  // Boundary buttresses, expansion seams, lamp strips and inset gates.
  for(let z=-22;z<=22;z+=7.5)for(const side of [-1,1]){B(side*23.8,3,z,.5,6.6,.7,C.edge);B(side*23.48,3.8,z,.05,1.4,.18,C.orange,.8);}
  for(let x=-21;x<=21;x+=7){B(x,3.6,-23.75,.65,7.2,.5,C.edge);B(x,3.6,23.7,.65,6,.4,C.edge);}
  B(0,2.6,-23.86,6,5,.12,C.charcoal);for(const x of [-2.65,2.65])B(x,2.6,-23.72,.12,5,.09,C.orange,.65);
  for(let y=.6;y<4.8;y+=.32)B(0,y,-23.7,5.1,.07,.06,C.metal);
  // Left workshop: deep door, windows, awning, rooftop equipment and pipework.
  B(-15.94,2.2,-4,.12,4.4,3.2,C.charcoal); B(-15.82,4.45,-4,.14,.12,3.5,C.orange,.6);
  for(const z of [-10,-.4]){B(-15.91,5,z,.14,1.5,2.5,C.charcoal);for(let j=0;j<4;j++)B(-15.79,4.55+j*.3,z,.04,.08,2.35,C.metal);}
  B(-14.4,4.9,-4,3.3,.12,5.7,C.metal);for(const z of [-6.7,-1.3])B(-12.9,2.45,z,.12,4.9,.12,C.charcoal);
  for(let i=0;i<7;i++)B(-14.5,4.99,-6.45+i*.8,3.1,.025,.35,i%2?C.sand:C.edge);
  B(-19.3,8.3,-9,3.4,1.2,2.3,C.metal);for(let i=0;i<6;i++)B(-17.55,8.3,-9.9+i*.34,.07,.7,.09,C.charcoal);
  B(-20,8.2,-.7,1.2,.8,2.5,C.charcoal);B(-17.9,9.1,-1.3,.22,3,.22,C.metal);
  for(let i=0;i<3;i++)B(-15.7,1.2+i*.35,-10.8,.3,.15,3.5,C.metal);
  // Right hangar, vent fins, orange gate and roof-mounted antenna.
  B(17,2.6,-11.93,5.5,5.2,.18,C.charcoal);
  for(const x of [14.1,19.9])B(x,3.1,-11.75,.18,6,.18,C.orange);
  B(17,5.75,-11.7,6.2,.35,.55,C.edge);for(let i=0;i<9;i++)B(17,.3+i*.55,-11.8,5.3,.08,.13,C.metal);
  for(let i=0;i<4;i++){B(12,5.8,-19.5+i*1.7,.12,2.2,.8,C.charcoal);B(12.08,5.8,-19.5+i*1.7,.04,.15,.65,C.orange,.4);}
  B(17,9.5,-18.8,3.6,.7,3,C.metal);B(18.5,11.3,-17,.15,4.2,.15,C.charcoal);
  beam(worldVertices,[18.5,10,-17],[21,11.8,-17],.1,C.metal);B(21,12,-17,.3,.5,1.7,C.edge);
  // Overhead service gantry and power cables.
  B(7.8,6.7,-17,.32,13.4,.32,C.charcoal);B(-8.7,6.7,-17,.32,13.4,.32,C.charcoal);B(-.45,12.8,-17,16.8,.25,.35,C.metal);
  for(let i=0;i<6;i++)B(-7.3+i*2.7,12.2,-17,.1,1,.1,C.charcoal);
  let previous=[-22,8,-12];for(let i=1;i<=20;i++){const x=-22+i*2.2,next=[x,8-2.2*Math.sin(i/20*Math.PI),-12];beam(worldVertices,previous,next,.035,C.charcoal);previous=next;}
  // Inlaid landing marks, drainage channels and approach lights.
  floorDecal(0,16,6.8,6.8,hex('#b09d79'));for(const z of [13,19])floorDecal(0,z,6.5,.09,C.edge);for(const x of [-3.2,3.2])floorDecal(x,16,.09,6,C.edge);
  for(let z=-20;z<22;z+=2.5){floorDecal(-3.9,z,.12,1.2,C.edge);floorDecal(3.9,z,.12,1.2,C.edge);}
  for(const x of [-22.7,22.7]){floorDecal(x,0,.35,45,C.charcoal);for(let z=-22;z<23;z+=.65)floorDecal(x,z,.48,.06,C.metal);}
  for(const x of [-11,11])for(const z of [-20,1,21]){B(x,.6,z,.16,1.2,.16,C.charcoal);B(x,1.23,z,.3,.16,.3,C.orange,1);}
  // Sand deposits and a distant mountain skyline are actual low-poly world geometry.
  const rng=Core.seededRandom(7081);
  for(let i=0;i<65;i++){const x=(rng()-.5)*46,z=(rng()-.5)*46;if(!Core.occupied(x,z,.5,1)&&Math.abs(x)>3.5)B(x,.03,z,.08+rng()*.25,.05+rng()*.12,.09+rng()*.3,hex('#a79573'),0,rng()*6);}
  for(let i=0;i<25;i++){const a=i/25*Math.PI*2,r=65+rng()*30;pyramid(worldVertices,Math.sin(a)*r,-1,Math.cos(a)*r,15+rng()*25,12+rng()*26,18+rng()*25,hex(i%2?'#9c9e88':'#a8a58b'));}
  // First-person weapon assembled once: receiver, barrel, rail, stock and gloved hands.
  const G=(...a)=>box(gunVertices,...a);
  G(.24,-.24,-.45,.2,.19,.6,C.charcoal);G(.24,-.145,-.49,.17,.045,.53,C.metal);
  G(.24,-.23,-.89,.095,.085,.38,C.black);G(.24,-.23,-1.1,.13,.12,.11,C.metal);
  G(.24,-.14,-.75,.16,.04,.2,C.sand);G(.24,-.09,-.58,.13,.09,.18,C.charcoal);
  G(.24,-.03,-.58,.15,.025,.2,C.metal);G(.24,-.08,-.48,.13,.11,.025,C.black);
  G(.24,-.07,-.466,.065,.035,.005,C.orange,.9);
  G(.24,-.38,-.38,.12,.25,.15,C.black);G(.24,-.42,-.36,.11,.12,.17,C.metal);
  G(.245,-.25,-.08,.16,.14,.24,C.metal);G(.245,-.28,.035,.2,.22,.1,C.charcoal);
  G(.35,-.39,-.2,.14,.19,.2,hex('#746c50'));G(.36,-.47,-.02,.17,.17,.27,C.charcoal);
  G(.14,-.35,-.7,.15,.16,.19,hex('#746c50'));G(.08,-.44,-.58,.17,.17,.3,C.charcoal);
  G(.343,-.235,-.45,.012,.07,.26,C.sand);G(.351,-.235,-.48,.009,.026,.12,C.orange);
  for(let i=0;i<6;i++){G(.24,-.112,-.32-i*.06,.19,.012,.025,C.black);G(.329,-.215,-.65-i*.025,.008,.045,.012,C.black);}
  function upload(vertices, usage=gl.STATIC_DRAW){const b=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,b);gl.bufferData(gl.ARRAY_BUFFER,new Float32Array(vertices),usage);return {buffer:b,count:vertices.length/10};}
  const worldMesh=upload(worldVertices),gunMesh=upload(gunVertices);
  const dynamicMesh={buffer:gl.createBuffer(),count:0};
  function bind(mesh){
    gl.bindBuffer(gl.ARRAY_BUFFER,mesh.buffer);
    for(const [name,size,offset] of [['aPosition',3,0],['aNormal',3,12],['aColor',3,24],['aGlow',1,36]]){const l=locations[name];gl.enableVertexAttribArray(l);gl.vertexAttribPointer(l,size,gl.FLOAT,false,40,offset);}
  }
  function draw(mesh,matrix=identity){gl.uniformMatrix4fv(locations.uModel,false,matrix);bind(mesh);gl.drawArrays(gl.TRIANGLES,0,mesh.count);}
  function addDrone(out,e,time){
    const angle=Math.atan2(game.player.x-e.x,game.player.z-e.z),y=e.y;
    const c=Math.cos(angle),s=Math.sin(angle),part=(x,dy,z,w,h,d,color,glow=0)=>box(out,e.x+x*c+z*s,y+dy,e.z-x*s+z*c,w,h,d,color,glow,angle);
    const body=e.flash>0?C.light:C.charcoal;
    part(0,0,0,1.05,.56,.82,body);part(0,.3,-.04,.8,.14,.6,C.metal);
    part(0,-.28,.12,.7,.15,.56,C.black);part(0,.02,.426,.78,.14,.04,C.black);
    part(0,.035,.456,.44,.08,.025,C.red,1);part(0,.035,.476,.14,.08,.02,C.orange,1);
    for(const side of [-1,1]){
      part(side*.72,-.02,-.02,.4,.34,.62,body);part(side*.72,-.22,-.02,.3,.1,.42,C.orange,.9);
      part(side*.72,.17,-.02,.36,.06,.54,C.metal);part(side*.46,0,-.07,.25,.1,.18,C.metal);
      part(side*.72,.22,-.02,.6,.025,.08,C.black,0);
    }
    part(0,-.38,-.05,.12,.25,.12,C.metal);part(0,-.4,.08,.14,.12,.34,C.charcoal);
    const size=.65+Math.sin(time*4+e.id)*.04;
    box(out,e.x,.035,e.z,1.4*size,.012,.8*size,hex('#8f7d61'));
  }
  function render(now){
    const w=canvas.width,h=canvas.height;gl.viewport(0,0,w,h);gl.clearColor(.4,.45,.4,1);gl.clear(gl.COLOR_BUFFER_BIT|gl.DEPTH_BUFFER_BIT);
    gl.disable(gl.DEPTH_TEST);gl.useProgram(skyProgram);gl.bindBuffer(gl.ARRAY_BUFFER,skyBuffer);gl.enableVertexAttribArray(skyAttr);gl.vertexAttribPointer(skyAttr,2,gl.FLOAT,false,0,0);gl.uniform2f(skySun,.54,.62);gl.drawArrays(gl.TRIANGLES,0,6);
    gl.useProgram(shader);gl.enable(gl.DEPTH_TEST);gl.depthFunc(gl.LEQUAL);gl.disable(gl.CULL_FACE);
    let eye,target;
    if(phase==='menu'||phase==='help') {eye=[18,5.4,22];target=[-3,4.8,-7];}
    else {const p=game.player,cp=Math.cos(p.pitch+recoil*.22);eye=[p.x,p.y+(reduced.matches?0:Math.sin(bob)*stride*.026),p.z];target=[p.x-Math.sin(p.yaw)*cp,eye[1]+Math.sin(p.pitch+recoil*.22),p.z-Math.cos(p.yaw)*cp];}
    const view=lookAt(eye,target),projection=perspective((phase==='playing'&&keys.has('ShiftLeft')?80:75)*Math.PI/180,w/h);
    gl.uniformMatrix4fv(locations.uVP,false,multiply(projection,view));gl.uniform3fv(locations.uEye,eye);gl.uniform1f(locations.uFog,1);gl.uniform1f(locations.uDetail,1);draw(worldMesh);
    const v=[];
    const drones=phase==='menu'||phase==='help'?[{x:5.5,y:2.9,z:5,id:1,flash:0},{x:-5,y:4.3,z:-13,id:2,flash:0},{x:15,y:3.3,z:-5,id:3,flash:0}]:game.enemies;
    for(const e of drones)addDrone(v,e,now);
    for(const b of game.projectiles){box(v,b.x,b.y,b.z,.15,.15,.15,C.red,1);beam(v,[b.x-b.vx*.035,b.y-b.vy*.035,b.z-b.vz*.035],[b.x,b.y,b.z],.055,C.orange,1);}
    for(const p of game.pickups){
      const y=.45+(reduced.matches?0:Math.sin(now*2+p.id)*.06),color=p.kind==='health'?C.green:C.orange;
      box(v,p.x,y,p.z,.75,.65,.65,C.charcoal);box(v,p.x,y+.34,p.z,.8,.06,.7,color,.5);
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
      const weaponMatrix=model(.025+sway,-.055-Math.abs(sway)-reloadAngle*.29,-.12+recoil*.17,1,1,1,reloadAngle*-.45,recoil*.22+reloadAngle*.55);
      draw(gunMesh,weaponMatrix);
      if(muzzle>0){const m=[];box(m,.24,-.23,-1.24,.13+Math.random()*.06,.13,.25,C.orange,1);box(m,.24,-.23,-1.3,.05,.26,.08,C.light,1);const mm=upload(m,gl.STREAM_DRAW);draw(mm,weaponMatrix);gl.deleteBuffer(mm.buffer);}
    }
  }
  function resize(){const height=canvas.clientHeight,ratio=Math.min(devicePixelRatio||1,touch?1.3:1.5,Math.sqrt(1800000/(innerWidth*height)));canvas.width=Math.round(innerWidth*ratio);canvas.height=Math.round(height*ratio);render(visualTime);}
  addEventListener('resize',resize);
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
    tone(110,.12,'sawtooth',.45,35);tone(650,.04,'square',.08,110);
    if(!audio||!soundOn)return;const n=Math.floor(audio.sampleRate*.075),b=audio.createBuffer(1,n,audio.sampleRate),d=b.getChannelData(0);for(let i=0;i<n;i++)d[i]=(Math.random()*2-1)*Math.pow(1-i/n,3);
    const source=audio.createBufferSource(),g=audio.createGain(),filter=audio.createBiquadFilter();filter.type='lowpass';filter.frequency.value=2400;source.buffer=b;g.gain.value=.27;source.connect(filter);filter.connect(g);g.connect(master);source.start();
  }
  function updateSoundButton(){const b=$('sound-btn');b.classList.toggle('muted-sound',!soundOn);b.setAttribute('aria-label',soundOn?'关闭声音':'开启声音');b.setAttribute('aria-pressed',String(!soundOn));}
  $('sound-btn').onclick=()=>{initAudio();soundOn=!soundOn;if(master)master.gain.value=soundOn?.24:0;try{localStorage.setItem('dustvector-muted',soundOn?'0':'1');}catch{}updateSoundButton();};updateSoundButton();
  $('fullscreen-btn').onclick=async()=>{try{if(document.fullscreenElement)await document.exitFullscreen();else await document.documentElement.requestFullscreen();}catch{showNotice('浏览器未允许全屏\n你仍可以在当前窗口游玩',2500);}};
  document.addEventListener('fullscreenchange',()=>{$('fullscreen-btn').setAttribute('aria-label',document.fullscreenElement?'退出全屏':'进入全屏');resize();});

  function showNotice(text,duration=2200){$('notice').textContent=text;$('notice').classList.add('visible');noticeUntil=performance.now()+duration;}
  function clearInput(){keys.clear();firing=false;viewDrag=null;lookTouch.id=null;joystick.x=0;joystick.y=0;joystick.id=null;$('joystick-thumb').style.transform='';}
  function setPhase(next){
    phase=next;document.body.classList.toggle('playing',next==='playing');document.body.classList.toggle('overlay-open',next==='paused'||next==='won'||next==='lost');
    $('menu').hidden=next!=='menu'&&next!=='help';$('hud').hidden=next==='menu'||next==='help';$('help-screen').hidden=next!=='help';
    $('pause-screen').hidden=next!=='paused';$('result-screen').hidden=next!=='won'&&next!=='lost';$('touch-controls').hidden=next!=='playing'||!touch;
    $('nav-state').textContent=next==='playing'?'行动进行中':next==='paused'?'行动暂停':next==='won'?'任务完成':next==='lost'?'行动结束':'单人行动';
    clearInput();render(visualTime);
  }
  async function captureMouse(){
    if(touch)return;
    try{pointerPending=true;const result=canvas.requestPointerLock();if(result&&result.catch)await result.catch(()=>{});}catch{/* drag-to-look and arrow keys are available */}finally{pointerPending=false;}
  }
  function start(){initAudio();game.start(hard);particles.length=0;tracers.length=0;damage=0;recoil=0;hitTime=0;muzzle=0;setPhase('playing');canvas.focus({preventScroll:true});captureMouse();processEvents();updateHUD();lastFrame=performance.now();}
  function pause(){if(phase!=='playing')return;game.state='paused';setPhase('paused');if(document.pointerLockElement===canvas)document.exitPointerLock();$('resume-btn').focus({preventScroll:true});}
  function resume(){if(phase!=='paused')return;initAudio();game.state='playing';setPhase('playing');canvas.focus({preventScroll:true});captureMouse();lastFrame=performance.now();}
  function menu(){game.state='menu';if(document.pointerLockElement===canvas)document.exitPointerLock();game.enemies=[];game.projectiles=[];game.pickups=[];particles.length=0;tracers.length=0;$('notice').classList.remove('visible');setPhase('menu');$('start-btn').focus({preventScroll:true});}
  function finish(won){
    setPhase(won?'won':'lost');if(document.pointerLockElement===canvas)document.exitPointerLock();
    $('result-eyebrow').textContent=won?'任务完成 / MISSION COMPLETE':'行动结束 / SIGNAL LOST';$('result-title').textContent=won?'中继站已肃清':'信号已中断';
    $('result-description').textContent=won?'所有无人机已清除，通信恢复。':'无人机仍在巡逻。调整路线，利用掩体再试一次。';
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
  // Touch input is explicit: left joystick, right look area, independent hold-to-fire.
  $('joystick').addEventListener('pointerdown',e=>{if(phase!=='playing')return;joystick.id=e.pointerId;$('joystick').setPointerCapture(e.pointerId);joystickMove(e);e.preventDefault();});
  function joystickMove(e){if(e.pointerId!==joystick.id)return;const r=$('joystick').getBoundingClientRect(),radius=r.width*.36;let x=e.clientX-r.left-r.width/2,y=e.clientY-r.top-r.height/2;const d=Math.hypot(x,y);if(d>radius){x*=radius/d;y*=radius/d;}joystick.x=x/radius;joystick.y=y/radius;$('joystick-thumb').style.transform=`translate(${x}px,${y}px)`;}
  $('joystick').addEventListener('pointermove',joystickMove);
  const joystickEnd=e=>{if(e.pointerId===joystick.id){joystick.id=null;joystick.x=0;joystick.y=0;$('joystick-thumb').style.transform='';}};
  $('joystick').addEventListener('pointerup',joystickEnd);$('joystick').addEventListener('pointercancel',joystickEnd);
  $('touch-look').addEventListener('pointerdown',e=>{lookTouch.id=e.pointerId;lookTouch.x=e.clientX;lookTouch.y=e.clientY;$('touch-look').setPointerCapture(e.pointerId);});
  $('touch-look').addEventListener('pointermove',e=>{if(phase!=='playing'||e.pointerId!==lookTouch.id)return;game.player.yaw-=(e.clientX-lookTouch.x)*.005;game.player.pitch=clamp(game.player.pitch-(e.clientY-lookTouch.y)*.005,-1.18,1.18);lookTouch.x=e.clientX;lookTouch.y=e.clientY;});
  const lookEnd=e=>{if(e.pointerId===lookTouch.id)lookTouch.id=null;};$('touch-look').addEventListener('pointerup',lookEnd);$('touch-look').addEventListener('pointercancel',lookEnd);
  $('touch-fire').addEventListener('pointerdown',e=>{if(phase!=='playing')return;initAudio();firing=true;$('touch-fire').setPointerCapture(e.pointerId);e.preventDefault();});
  for(const e of ['pointerup','pointercancel'])$('touch-fire').addEventListener(e,()=>firing=false);
  $('touch-reload').onclick=()=>game.reload();

  function burst(x,y,z,color,count=12,force=2){for(let i=0;i<count;i++)particles.push({x,y,z,vx:(Math.random()-.5)*force,vy:Math.random()*force,vz:(Math.random()-.5)*force,life:.3+Math.random()*.5,size:.025+Math.random()*.07,color,glow:count>15?.45:0});}
  function processEvents(){
    for(const e of game.drainEvents())switch(e.type){
      case 'shot':{
        recoil=Math.min(.16,recoil+.075);muzzle=.045;shotSound();
        const p=game.player,s=Math.sin(p.yaw),c=Math.cos(p.yaw);tracers.push({from:[p.x+c*.22-s*.7,p.y-.17,p.z-s*.22-c*.7],to:[e.end.x,e.end.y,e.end.z],life:.04});break;}
      case 'hit':hitTime=.16;$('hit-marker').classList.remove('kill');tone(450,.055,'triangle',.13,700);break;
      case 'kill':hitTime=.3;$('hit-marker').classList.add('kill');burst(e.x,e.y,e.z,C.orange,24,3.4);tone(85,.25,'sawtooth',.25,25);break;
      case 'impact':burst(e.x,e.y,e.z,C.edge,5,1.5);break;
      case 'damage':damage=.85;tone(85,.18,'sine',.45,35);break;
      case 'reload':tone(340,.1,'square',.08,200);break;
      case 'reloaded':tone(540,.09,'square',.07,300);break;
      case 'noReserve':showNotice('备弹不足 · 寻找橙色弹药补给',2200);break;
      case 'wave':showNotice('第 '+e.wave+' 波 / 共 3 波\n清除 '+e.count+' 架无人机',2600);tone(280,.18,'sine',.18,420);break;
      case 'waveClear':showNotice('第 '+e.wave+' 波已清除\n生命 +20 · 备弹 +48 · 下一波即将抵达',3800);tone(440,.25,'sine',.2,660);break;
      case 'pickup':showNotice(e.kind==='health'?'获得医疗补给 · 生命 +35':'获得弹药补给 · 备弹 +36',1600);tone(550,.12,'sine',.14,880);break;
      case 'enemyShot':if(Math.hypot(game.player.x-e.x,game.player.z-e.z)<12)tone(250,.1,'triangle',.04,100);break;
      case 'won':finish(true);break;case 'lost':finish(false);break;
    }
  }
  const radar=$('radar').getContext('2d');
  function updateRadar(){
    const ctx=radar,w=144,c=72,scale=2.25,p=game.player;ctx.clearRect(0,0,w,w);ctx.save();ctx.translate(c,c);
    ctx.strokeStyle='#cdbd951f';ctx.lineWidth=1;for(const r of [24,48,68]){ctx.beginPath();ctx.arc(0,0,r,0,Math.PI*2);ctx.stroke();}
    ctx.beginPath();ctx.moveTo(-68,0);ctx.lineTo(68,0);ctx.moveTo(0,-68);ctx.lineTo(0,68);ctx.stroke();
    ctx.save();ctx.beginPath();ctx.arc(0,0,68,0,Math.PI*2);ctx.clip();ctx.rotate(-p.yaw);ctx.translate(-p.x*scale,-p.z*scale);
    ctx.fillStyle='#b9b09355';for(const b of Core.COLLIDERS)ctx.fillRect((b.x-b.w/2)*scale,(b.z-b.d/2)*scale,b.w*scale,b.d*scale);
    ctx.fillStyle='#f0755b';for(const e of game.enemies){ctx.beginPath();ctx.arc(e.x*scale,e.z*scale,2.7,0,Math.PI*2);ctx.fill();}
    ctx.fillStyle='#c1db9b';for(const i of game.pickups)ctx.fillRect(i.x*scale-2,i.z*scale-2,4,4);ctx.restore();
    ctx.fillStyle='#f5e7ca';ctx.beginPath();ctx.moveTo(0,-6);ctx.lineTo(-4,4);ctx.lineTo(0,2);ctx.lineTo(4,4);ctx.closePath();ctx.fill();ctx.restore();
  }
  function updateHUD(){
    const p=game.player;$('health-value').textContent=Math.ceil(p.hp);$('health-fill').style.width=p.hp+'%';$('health-fill').style.background=p.hp<30?'#ed765f':'#d9e7b4';$('health-label').textContent=p.hp<30?'生命值低 · 寻找绿色补给':'生命状态正常';
    $('ammo-value').textContent=String(game.ammo).padStart(2,'0');$('ammo-value').style.color=game.ammo<6?'#f39b74':'';$('reserve-value').textContent=game.reserve;
    $('wave-value').textContent=String(game.wave).padStart(2,'0');$('remaining-value').textContent=game.waveDelay>0?'下一波准备中':'剩余 '+game.enemies.length+' 架';$('score-value').textContent=String(game.score).padStart(4,'0');
    document.querySelectorAll('.wave-progress i').forEach((e,i)=>e.classList.toggle('active',i<game.wave));
    let degrees=((p.yaw*180/Math.PI)%360+360)%360;degrees=(360-degrees)%360;const dirs=['N','NE','E','SE','S','SW','W','NW'];$('compass').textContent=dirs[Math.round(degrees/45)%8]+'   · · ·   '+String(Math.round(degrees)).padStart(3,'0')+'   · · ·';
    $('reload-notice').hidden=game.reloadTime<=0;$('reload-fill').style.width=(1-game.reloadTime/1.65)*100+'%';updateRadar();
  }
  let hudClock=0;
  function frame(now){
    const dt=Math.min((now-lastFrame)/1000,.05);lastFrame=now;
    if(phase==='playing'){
      const input={forward:(keys.has('KeyW')?1:0)-(keys.has('KeyS')?1:0)-joystick.y,strafe:(keys.has('KeyD')?1:0)-(keys.has('KeyA')?1:0)+joystick.x,
        turn:(keys.has('ArrowLeft')?1:0)-(keys.has('ArrowRight')?1:0),look:(keys.has('ArrowUp')?1:0)-(keys.has('ArrowDown')?1:0),sprint:keys.has('ShiftLeft')||keys.has('ShiftRight'),fire:firing||keys.has('Space')};
      game.update(dt,input);processEvents();visualTime+=dt;recoil*=Math.exp(-dt*19);muzzle=Math.max(0,muzzle-dt);damage=Math.max(0,damage-dt*1.6);hitTime=Math.max(0,hitTime-dt);
      stride+=(Math.min(1,Math.hypot(input.forward,input.strafe))-stride)*Math.min(1,dt*10);bob+=dt*(input.sprint?16:11);
      for(let i=particles.length-1;i>=0;i--){const p=particles[i];p.life-=dt;p.x+=p.vx*dt;p.y+=p.vy*dt;p.z+=p.vz*dt;p.vy-=dt*6;if(p.life<=0||p.y<.02)particles.splice(i,1);}
      for(let i=tracers.length-1;i>=0;i--){tracers[i].life-=dt;if(tracers[i].life<=0)tracers.splice(i,1);}
      $('damage-vignette').style.opacity=damage;$('hit-marker').style.opacity=hitTime>0?'1':'0';$('crosshair').classList.toggle('firing',game.fireCooldown>.065);
      if(now>noticeUntil)$('notice').classList.remove('visible');
      hudClock+=dt;if(hudClock>.08){hudClock=0;updateHUD();}render(visualTime);
    }
    requestAnimationFrame(frame);
  }
  // Read-only state is useful for accessibility helpers and browser smoke tests.
  window.Dustvector=Object.freeze({getState:()=>({phase,wave:game.wave,health:game.player.hp,ammo:game.ammo,reserve:game.reserve,enemies:game.enemies.length,kills:game.kills,score:game.score,time:game.time,position:{x:game.player.x,y:game.player.y,z:game.player.z},view:{yaw:game.player.yaw,pitch:game.player.pitch},targets:game.enemies.map(e=>({x:e.x,y:e.y,z:e.z,hp:e.hp})),pointerLocked:document.pointerLockElement===canvas,hard})});
  resize();document.documentElement.dataset.ready='1';requestAnimationFrame(frame);
})();
