const {test}=require('node:test');
const assert=require('node:assert/strict');
const TouchInput=require('../touch-input.js');
function setup(){
  const classes=new Set(),looks=[];
  const classList={add:x=>classes.add(x),remove:x=>classes.delete(x),toggle:(x,on)=>on?classes.add(x):classes.delete(x)};
  const surface={addEventListener(){},removeEventListener(){},setPointerCapture(){},releasePointerCapture(){},classList,getBoundingClientRect:()=>({left:0,top:64,width:390,height:780})};
  const stick={offsetWidth:118,style:{},classList},thumb={style:{}};
  const state={active:true,wakes:0};
  const input=new TouchInput(surface,stick,thumb,{active:()=>state.active,wake:()=>state.wakes++,look:(x,y)=>looks.push([x,y])});
  const event=(id,x,y,button=null)=>({pointerId:id,pointerType:'touch',clientX:x,clientY:y,target:{closest:()=>button?{id:button}:null},preventDefault(){}});
  return{input,event,state,looks,stick,thumb};
}
test('movement begins anywhere on the left and keeps working after crossing the screen',()=>{
  const {input,event,stick}=setup();input.down(event(1,30,300));assert.equal(input.moveId,1);assert.equal(input.x,0);
  input.motion(event(1,80,250));assert.ok(input.x>0);assert.ok(input.y<0);assert.ok(Math.hypot(input.x,input.y)<=1.001);
  input.motion(event(1,350,300));assert.equal(input.moveId,1);assert.equal(input.lookId,null);assert.ok(input.x>.99);
  input.up(event(1,350,300));assert.equal(input.x,0);assert.equal(input.y,0);assert.equal(stick.style.left,'');
});
test('moving and dragging the fire button work simultaneously with two fingers',()=>{
  const {input,event,looks,state}=setup();input.down(event(1,90,600));input.motion(event(1,90,520));
  input.down(event(2,320,650,'touch-fire'));input.motion(event(2,280,620,'touch-fire'));
  assert.ok(input.y<0);assert.equal(input.fire,true);assert.equal(state.wakes,1);assert.equal(looks.length,1);assert.ok(looks[0][0]<0);assert.ok(looks[0][1]<0);
  input.up(event(2,280,620));assert.equal(input.fire,false);assert.ok(input.y<0);assert.equal(input.moveId,1);
  input.up(event(1,90,520));assert.equal(input.pointers.size,0);
});
test('turning tracks the same pointer outside its starting region and sensitivity is adjustable',()=>{
  const {input,event,looks}=setup();input.sensitivity=1.5;input.down(event(7,300,400));input.motion(event(7,100,440));
  assert.equal(input.lookId,7);assert.equal(looks.length,1);assert.ok(Math.abs(looks[0][0]-(-200*.0045*1.5))<1e-9);
  assert.equal(input.moveId,null);input.up(event(7,100,440));assert.equal(input.lookId,null);
});
test('capture loss and pause reset cannot leave firing or moving latched',()=>{
  const {input,event}=setup();input.down(event(1,70,500));input.motion(event(1,70,430));input.down(event(2,320,650,'touch-fire'));
  input.up(event(2,320,650));assert.equal(input.fire,false);
  input.reset();assert.equal(input.pointers.size,0);assert.equal(input.moveId,null);assert.equal(input.lookId,null);assert.equal(input.x,0);assert.equal(input.y,0);assert.equal(input.sprint,false);
  input.up(event(1,70,430));assert.equal(input.y,0);
});
test('an extra finger never steals the joystick and reload is not classified as looking',()=>{
  const {input,event}=setup();input.down(event(1,70,500));input.down(event(2,100,550));assert.equal(input.pointers.size,1);assert.equal(input.moveId,1);
  input.down(event(3,240,650,'touch-reload'));assert.equal(input.pointers.size,1);assert.equal(input.lookId,null);
});
test('only a deliberate long forward push enables sprint and paused inputs are ignored',()=>{
  const {input,event,state}=setup();input.down(event(1,80,600));input.motion(event(1,80,597));assert.equal(input.y,0);assert.equal(input.sprint,false);
  input.motion(event(1,80,500));assert.equal(input.sprint,true);input.reset();state.active=false;input.down(event(2,330,620,'touch-fire'));assert.equal(input.fire,false);assert.equal(input.pointers.size,0);
});
