import * as THREE from 'three';
import {OrbitControls} from 'three/addons/controls/OrbitControls.js';

const C={road:0x253649,edge:0x46dfb1,line:0xe6edf7,car:0x68a9ff,camera:0xffbe74};
function label(text,size=0.75,color='#e0eafa'){
  const canvas=document.createElement('canvas');canvas.width=256;canvas.height=64;
  const ctx=canvas.getContext('2d');ctx.clearRect(0,0,256,64);ctx.fillStyle='#101c2de8';ctx.roundRect(2,3,252,58,12);ctx.fill();
  ctx.font='bold 29px system-ui,sans-serif';ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillStyle=color;ctx.fillText(text,128,32);
  const texture=new THREE.CanvasTexture(canvas),material=new THREE.SpriteMaterial({map:texture,depthWrite:false,transparent:true});
  const sprite=new THREE.Sprite(material);sprite.scale.set(size*2.5,size*0.63,1);return sprite;
}
function material(color,extra={}){return new THREE.MeshStandardMaterial({color,roughness:.78,metalness:.12,...extra});}
function mesh(geom,mat,group,x=0,y=0,z=0){const obj=new THREE.Mesh(geom,mat);obj.position.set(x,y,z);group.add(obj);return obj;}
function line(points,color,opacity=1){const geo=new THREE.BufferGeometry().setFromPoints(points.map(p=>new THREE.Vector3(...p)));return new THREE.Line(geo,new THREE.LineBasicMaterial({color,transparent:opacity<1,opacity,depthTest:true}));}
function disposeGroup(group){
  for(const child of [...group.children]){group.remove(child);child.traverse(obj=>{if(obj.geometry)obj.geometry.dispose();if(obj.material){for(const m of (Array.isArray(obj.material)?obj.material:[obj.material])){if(m.map)m.map.dispose();m.dispose();}}});}
}
function createCar(group,x,y,idx){
  const car=new THREE.Group();const colors=[0x65aaff,0xff9a65,0xa7db83,0xbca1f8,0xf3d46b];
  const paint=material(colors[idx%colors.length]),glass=material(0x19293d,{metalness:.25,roughness:.38}),wheel=material(0x121c2b),light=material(0xf7e8a4,{emissive:0x423315});
  mesh(new THREE.BoxGeometry(1.82,.47,4.35),paint,car,0,.62,0);
  mesh(new THREE.BoxGeometry(1.55,.64,2.25),glass,car,0,1.14,-.15);
  mesh(new THREE.BoxGeometry(.48,.13,.07),light,car,-.54,.74,-2.18);
  mesh(new THREE.BoxGeometry(.48,.13,.07),light,car,.54,.74,-2.18);
  for(const dx of [-.91,.91])for(const dz of [-1.34,1.34]){
    const w=mesh(new THREE.CylinderGeometry(.35,.35,.19,12),wheel,car,dx,.37,dz);w.rotation.z=Math.PI/2;
  }
  car.position.set(x,0,-y);group.add(car);
  return car;
}
export function createScene(container,onPlaceCar){
  const scene=new THREE.Scene();scene.background=new THREE.Color(0x101e2e);scene.fog=new THREE.Fog(0x101e2e,80,230);
  const viewer=new THREE.PerspectiveCamera(52,1,.1,1200);
  const renderer=new THREE.WebGLRenderer({antialias:true,powerPreference:'low-power'});
  renderer.setPixelRatio(Math.min(window.devicePixelRatio||1,1.8));
  renderer.outputColorSpace=THREE.SRGBColorSpace;
  container.querySelector('#sceneMessage')?.remove();container.appendChild(renderer.domElement);
  renderer.domElement.setAttribute('aria-label','3D calibrated road, camera and cars. Drag to orbit.');
  const orbit=new OrbitControls(viewer,renderer.domElement);orbit.enableDamping=true;orbit.dampingFactor=.08;orbit.maxPolarAngle=Math.PI*.49;orbit.minDistance=4;orbit.maxDistance=260;
  scene.add(new THREE.HemisphereLight(0xdef8ff,0x29384d,2.35));
  const sun=new THREE.DirectionalLight(0xf0f8ff,2.2);sun.position.set(20,38,4);scene.add(sun);
  const root=new THREE.Group();scene.add(root);
  let width=7,length=25,addMode=false;
  function reset(){const d=Math.max(length,22);viewer.position.set(Math.max(width*2,18),Math.max(13,d*.65),Math.max(15,d*.3));orbit.target.set(0,0,-length*.48);viewer.lookAt(orbit.target);orbit.update();}
  function update(opts){
    width=Math.max(.1,opts.width);length=Math.max(.1,opts.length);disposeGroup(root);
    const ground=material(0x152b30);
    mesh(new THREE.PlaneGeometry(Math.max(width+18,35),Math.max(length+16,55)),ground,root,0,-.055,-length/2).rotation.x=-Math.PI/2;
    mesh(new THREE.BoxGeometry(width,.08,length),material(C.road),root,0,.002,-length/2);
    const dash=material(C.line,{emissive:0x18202a});
    const stripe=material(C.edge);
    for(const x of [-width/2+.10,width/2-.10])mesh(new THREE.BoxGeometry(.10,.014,length),stripe,root,x,.06,-length/2);
    for(let y=1;y<length-1;y+=4)mesh(new THREE.BoxGeometry(.10,.015,Math.min(2.0,length-y)),dash,root,0,.065,-y-1);
    const gridColor=0x315164;
    for(let y=0;y<=length+.001;y+=5){root.add(line([[-width/2,.083,-y],[width/2,.083,-y]],gridColor));const l=label(y+' m',.7);l.position.set(width/2+1.1,.5,-y);root.add(l);}
    for(let x=-width/2;x<=width/2+.01;x+=1)root.add(line([[x,.082,0],[x,.082,-length]],0x2c465b,.44));
    for(let i=0;i<opts.cars.length;i++)createCar(root,opts.cars[i].x,opts.cars[i].y,i);
    const p=opts.pose;
    if(p&&p.position.z<200){
      const pos=new THREE.Vector3(p.position.x,p.position.z,-p.position.y);
      const target=pos.clone().add(new THREE.Vector3(p.forward.x,p.forward.z,-p.forward.y).multiplyScalar(3));
      const icon=new THREE.Group();
      mesh(new THREE.BoxGeometry(.9,.56,.65),material(C.camera),icon,0,0,0);
      const lens=mesh(new THREE.CylinderGeometry(.21,.3,.45,12),material(0x192a3f),icon,0,0,-.46);lens.rotation.x=Math.PI/2;
      const up=new THREE.Vector3(p.up.x,p.up.z,-p.up.y).normalize();
      if(up.lengthSq()>.2)icon.up.copy(up);
      icon.position.copy(pos);icon.lookAt(target);root.add(icon);
      const l=label('CAMERA · '+p.position.z.toFixed(1)+' m',1.4,'#ffc887');l.position.copy(pos).add(new THREE.Vector3(0,1.2,0));root.add(l);
      for(const x of [-width/2,width/2])for(const y of [0,length])root.add(line([[pos.x,pos.y,pos.z],[x,.08,-y]],0xf3bd7b,.66));
      root.add(line([[pos.x,0,pos.z],[pos.x,pos.y,pos.z]],0xf3bd7b,.6));
      root.add(line([[pos.x-.22,.04,pos.z],[pos.x+.22,.04,pos.z]],0xf3bd7b));
      const h=label(p.position.z.toFixed(1)+' m high',.95,'#ffc887');h.position.set(pos.x+.7,pos.y/2,pos.z);root.add(h);
    }else{
      const l=label('Camera pose needs valid FOV + calibration',3,'#ffc887');l.position.set(0,3,-length/2);root.add(l);
    }
    if(!orbit.userData?.hasMoved)reset();
  }
  function resize(){
    const {width:w,height:h}=container.getBoundingClientRect();if(w<=0||h<=0)return;
    renderer.setSize(w,h,false);viewer.aspect=w/h;viewer.updateProjectionMatrix();
  }
  const observer=new ResizeObserver(resize);observer.observe(container);resize();
  orbit.addEventListener('start',()=>{orbit.userData={hasMoved:true};});
  let raf=0,running=true;
  function tick(){if(!running)return;raf=requestAnimationFrame(tick);orbit.update();renderer.render(scene,viewer);}
  tick();
  const raycaster=new THREE.Raycaster(),plane=new THREE.Plane(new THREE.Vector3(0,1,0),0);
  let pointerStart=null;
  renderer.domElement.addEventListener('pointerdown',e=>{pointerStart={x:e.clientX,y:e.clientY};});
  renderer.domElement.addEventListener('pointerup',e=>{
    if(!addMode||!pointerStart||Math.hypot(e.clientX-pointerStart.x,e.clientY-pointerStart.y)>6)return;
    const rect=renderer.domElement.getBoundingClientRect(),mouse=new THREE.Vector2(((e.clientX-rect.left)/rect.width)*2-1,-((e.clientY-rect.top)/rect.height)*2+1);
    raycaster.setFromCamera(mouse,viewer);const hit=new THREE.Vector3();
    if(raycaster.ray.intersectPlane(plane,hit)&&Math.abs(hit.x)<=width/2&&-hit.z>=0&&-hit.z<=length)onPlaceCar({x:hit.x,y:-hit.z});
  });
  return {update,reset,setAddMode(v){addMode=v;renderer.domElement.style.cursor=v?'crosshair':'grab';},dispose(){running=false;cancelAnimationFrame(raf);observer.disconnect();orbit.dispose();disposeGroup(root);renderer.dispose();renderer.domElement.remove();}};
}
