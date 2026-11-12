const {test}=require('node:test');
const assert=require('node:assert/strict');
const {Game,rayBox,raySphere,move,occupied}=require('../game-core.js');
const tick=(g,seconds,input={})=>{for(let t=0;t<seconds;t+=.02)g.update(.02,input);};

test('rays handle direct hits, parallel misses and an origin inside cover',()=>{
  const b={x:0,y:1,z:0,w:2,h:2,d:2};
  assert.equal(rayBox({x:0,y:1,z:5},{x:0,y:0,z:-1},b),4);
  assert.equal(rayBox({x:3,y:1,z:5},{x:0,y:0,z:-1},b),Infinity);
  assert.equal(rayBox({x:0,y:1,z:0},{x:0,y:0,z:1},b),0);
  assert.equal(raySphere({x:0,y:0,z:5},{x:0,y:0,z:-1},{x:0,y:0,z:0},1),4);
});
test('movement cannot tunnel through a wall and diagonal speed remains bounded',()=>{
  const p={x:0,z:22};move(p,0,20,.38,1);assert.ok(p.z<23.63);assert.ok(!occupied(p.x,p.z,.38,1));
  const a=new Game(1),b=new Game(1);a.start();b.start();tick(a,1,{forward:1});tick(b,1,{forward:1,strafe:1});
  const da=Math.hypot(a.player.x,a.player.z-18),db=Math.hypot(b.player.x,b.player.z-18);assert.ok(Math.abs(da-db)<.01);
});
test('shots damage the nearest visible drone, consume ammo and respect solid cover',()=>{
  const g=new Game(2);g.start();g.enemies=[{id:1,x:0,y:1.65,z:12,hp:64,phase:0,cooldown:99,turn:1}];
  g.shoot();assert.equal(g.ammo,23);assert.equal(g.enemies[0].hp,30);assert.equal(g.hits,1);
  g.fireCooldown=0;g.shoot();assert.equal(g.kills,1);assert.equal(g.score,100);assert.ok(g.waveDelay>0);
  g.player={x:0,y:1.65,z:0,yaw:0,pitch:0,hp:100};g.enemies=[{id:2,x:0,y:1.65,z:-15,hp:64}];g.fireCooldown=0;g.shoot();assert.equal(g.enemies[0].hp,64);
});
test('reload transfers only available rounds and paused simulation freezes time and reload',()=>{
  const g=new Game(3);g.start();g.ammo=3;g.reserve=7;assert.ok(g.reload());
  g.state='paused';tick(g,2);assert.equal(g.reloadTime,1.65);assert.equal(g.time,0);assert.equal(g.ammo,3);
  g.state='playing';tick(g,1.8);assert.equal(g.ammo,10);assert.equal(g.reserve,0);assert.equal(g.reloadTime,0);assert.equal(g.reload(),false);
});
test('all three waves advance, award supplies and finish the campaign',()=>{
  const g=new Game(4);g.start();assert.equal(g.enemies.length,4);
  for(let wave=1;wave<=3;wave++){
    assert.equal(g.wave,wave);assert.equal(g.enemies.length,2+wave*2);
    for(const e of [...g.enemies])g.killEnemy(e);
    if(wave<3){assert.equal(g.state,'playing');tick(g,4.6);}else assert.equal(g.state,'won');
  }
  assert.equal(g.kills,18);assert.ok(g.score>1800);assert.equal(g.enemies.length,0);
});
test('health cannot drop below zero, and completed games ignore additional damage',()=>{
  const g=new Game(5);g.start();g.damage(150);assert.equal(g.player.hp,0);assert.equal(g.state,'lost');
  const time=g.time;tick(g,1,{fire:true});assert.equal(g.time,time);assert.equal(g.shots,0);
});
test('enemy projectiles hit the player or are stopped by cover',()=>{
  const g=new Game(6);g.start();g.enemies=[];
  g.projectiles=[{x:0,y:1.65,z:16,vx:0,vy:0,vz:10,life:2}];tick(g,.3);assert.equal(g.player.hp,91);
  g.player.x=0;g.player.z=-15;g.damageGrace=0;
  g.projectiles=[{x:0,y:1.65,z:0,vx:0,vy:0,vz:-40,life:2}];tick(g,.5);assert.equal(g.player.hp,91);assert.equal(g.projectiles.length,0);
});
test('pickups restore bounded health and add reserve ammo',()=>{
  const g=new Game(7);g.start();g.enemies=[];g.player.hp=90;
  g.pickups=[{id:1,x:0,z:18,kind:'health'},{id:2,x:0,z:18,kind:'ammo'}];g.update(.02);
  assert.equal(g.player.hp,100);assert.equal(g.reserve,156);assert.equal(g.pickups.length,0);
});
test('high-pressure mode changes actual enemy count and health',()=>{
  const g=new Game(8);g.start(true);assert.equal(g.enemies.length,5);assert.equal(g.enemies[0].hp,80);
});
