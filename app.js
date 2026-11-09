import {calculateHomography,invert3,project,worldCorners,convexCorners,validate,estimateCamera,matrixToCfg} from './geometry.js';

const $=id=>document.getElementById(id);
const names=['Near left','Near right','Far right','Far left'];
const state={image:null,dataUrl:null,imageName:'',points:[],width:7,length:25,hfov:75,H:null,inv:null,pose:null,cars:[],selected:0,dragging:-1,dragCar:-1,addCar:false,measurement:[],imagePixels:null,scene:null,tutorialIndex:0,renderTimer:0};
const src=$('sourceCanvas'),bev=$('bevCanvas'),sourceCtx=src.getContext('2d'),bevCtx=bev.getContext('2d');
const tutorialSteps=[
  {title:'Load the actual camera background',body:'Upload background.jpg or a still frame from the camera. It should show the full road surface, ideally without vehicles obscuring your reference points. Calibration points are stored in original image pixels.',warning:'Crucial: the matrix must be applied to frames using the same geometry, cropping, mirroring, rotation, dewarping and resolution. If the detector uses a resized or dewarped frame instead, transform the points accordingly.',diagram:'image'},
  {title:'Choose four corners of a flat rectangle',body:'Select four ground-level corners in this exact order: 1 near left, 2 near right, 3 far right, 4 far left. They must correspond to the corners of the SAME physical rectangle. Drag the handles or select a corner and click its location.',warning:'All four points must lie on one approximately flat road plane. Do not place points on vehicles, curbs, road signs, walls or the horizon.',diagram:'quad'},
  {title:'Measure the rectangle in meters',body:'Set the real left-to-right width and near-to-far length. You can use measured tape/laser distances, surveyed road markings or known ground coordinates. A visually guessed width or length produces guessed speeds.',warning:'If the marked quadrilateral is not actually a rectangle, the generated image may look good but the metric geometry will be wrong. Prefer reliable landmarks with surveyed locations.',diagram:'measure'},
  {title:'Inspect the bird’s-eye preview',body:'After rectification, painted straight road markings should remain straight. Parallel lines on the flat road should appear approximately parallel. A measured 5 m separation should occupy five grid meters everywhere on the calibrated patch.',warning:'Do not expect buildings, trees or cars to look correct in the BEV: objects above the road plane will be stretched or distorted. That is normal for a planar homography.',diagram:'bev'},
  {title:'Inspect the 3D plane, camera and cars',body:'Orbit the 3D road with your mouse or touch. The green edges define your measured rectangle. Orange rays connect an estimated camera to each corner. Add cars by clicking the road in 3D or the BEV; they remain on the ground plane. Tap any two locations in the BEV to measure their distance.',warning:'The approximate 3D camera height and pose are estimated using the horizontal FOV you provide and a pinhole camera assumption. A planar homography alone cannot identify lens distortion or true camera intrinsics.',diagram:'scene'},
  {title:'Validate and export',body:'Download the 3×3 comma-separated matrix as homography_matrix_manual.cfg. Copy it to ~/.config/traffic-counting/homography_matrix_manual.cfg and enable processing.speed_measurement.method: homography_matrix_manual. Save the project JSON for future point adjustments.',warning:'Four points always fit exactly: this does not certify accuracy. Verify at least one independent road distance and, for speed measurement, compare against an external speed reference.',diagram:'export'}
];
function toast(message){$('toast').textContent=message;$('toast').classList.add('visible');clearTimeout(toast.timer);toast.timer=setTimeout(()=>$('toast').classList.remove('visible'),3400);}
function download(filename,data,mime){const a=document.createElement('a'),url=URL.createObjectURL(new Blob([data],{type:mime}));a.href=url;a.download=filename;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),2000);}
function validDims(){return Number.isFinite(state.width)&&Number.isFinite(state.length)&&state.width>0&&state.length>0&&state.width<=200&&state.length<=500;}
function dimensions(){state.width=Number($('widthMeters').value);state.length=Number($('lengthMeters').value);recompute();}
function defaultPoints(w,h){return [{x:w*.16,y:h*.9},{x:w*.84,y:h*.9},{x:w*.58,y:h*.45},{x:w*.42,y:h*.45}];}
function clamp(v,lo,hi){return Math.max(lo,Math.min(hi,v));}
async function readImageDataUrl(data,name,restored=null){
  if(!/^data:image\/(png|jpeg|webp|bmp);base64,/i.test(data))throw Error('Only PNG, JPEG, WebP or BMP images are supported');
  const img=new Image();await new Promise((resolve,reject)=>{img.onload=resolve;img.onerror=()=>reject(Error('Could not read image'));img.src=data;});
  if(!img.naturalWidth||!img.naturalHeight||img.naturalWidth>14000||img.naturalHeight>14000||img.naturalWidth*img.naturalHeight>50000000)throw Error('Unsupported image size (max 50 megapixels)');
  if(restored?.expectedImageWidth&&(img.naturalWidth!==restored.expectedImageWidth||img.naturalHeight!==restored.expectedImageHeight))throw Error('Project image dimensions do not match its saved calibration');
  state.image=img;state.dataUrl=data;state.imageName=name;state.points=restored?.points||defaultPoints(img.naturalWidth,img.naturalHeight);state.width=restored?.width??state.width;state.length=restored?.length??state.length;state.hfov=restored?.hfov??state.hfov;state.cars=restored?.cars||[];state.selected=0;state.measurement=[];state.H=null;
  $('widthMeters').value=state.width;$('lengthMeters').value=state.length;$('hfov').value=state.hfov;$('fovValue').textContent=state.hfov+'°';
  // Source buffer may be downscaled for fast pixel sampling, WITHOUT changing calibration coordinates.
  const factor=Math.min(1,1600/Math.max(img.naturalWidth,img.naturalHeight));
  const off=document.createElement('canvas');off.width=Math.max(1,Math.round(img.naturalWidth*factor));off.height=Math.max(1,Math.round(img.naturalHeight*factor));
  const oc=off.getContext('2d',{willReadFrequently:true});oc.drawImage(img,0,0,off.width,off.height);
  state.imagePixels={data:oc.getImageData(0,0,off.width,off.height).data,width:off.width,height:off.height};
  const s=Math.min(1,1400/Math.max(img.naturalWidth,img.naturalHeight));
  src.width=Math.max(1,Math.round(img.naturalWidth*s));src.height=Math.max(1,Math.round(img.naturalHeight*s));
  $('sourcePlaceholder').hidden=true;$('bevPlaceholder').hidden=true;
  $('imageMeta').textContent=name+' · '+img.naturalWidth+' × '+img.naturalHeight+' px';
  $('imageDims').textContent=img.naturalWidth+' × '+img.naturalHeight+' px';
  recompute();
}
function readFile(file){if(!file)return; if(!/^image\/(jpeg|png|webp|bmp)$/.test(file.type)){toast('Choose a PNG, JPEG, WebP or BMP file.');return;}const reader=new FileReader();reader.onload=()=>readImageDataUrl(reader.result,file.name).then(()=>toast('Image loaded. Adjust all four road corners.')).catch(e=>toast(e.message));reader.onerror=()=>toast('Could not read file');reader.readAsDataURL(file);}
$('fileInput').addEventListener('change',e=>readFile(e.target.files?.[0]));
const drop=$('dropzone');for(const type of ['dragenter','dragover'])drop.addEventListener(type,e=>{e.preventDefault();drop.classList.add('dragover');});
for(const type of ['dragleave','drop'])drop.addEventListener(type,e=>{e.preventDefault();drop.classList.remove('dragover');});
drop.addEventListener('drop',e=>readFile(e.dataTransfer?.files?.[0]));
function buildDemo(){
  const c=document.createElement('canvas');c.width=1280;c.height=720;const g=c.getContext('2d');
  const sky=g.createLinearGradient(0,0,0,370);sky.addColorStop(0,'#567b9d');sky.addColorStop(1,'#a6bac2');g.fillStyle=sky;g.fillRect(0,0,1280,360);
  g.fillStyle='#49695a';g.fillRect(0,338,1280,35);
  g.fillStyle='#405a44';g.beginPath();g.moveTo(0,340);g.lineTo(340,338);g.lineTo(0,720);g.closePath();g.fill();
  g.fillStyle='#58714c';g.beginPath();g.moveTo(940,340);g.lineTo(1280,340);g.lineTo(1280,720);g.closePath();g.fill();
  const asphalt=g.createLinearGradient(0,310,0,720);asphalt.addColorStop(0,'#465261');asphalt.addColorStop(1,'#293443');g.fillStyle=asphalt;g.beginPath();g.moveTo(566,310);g.lineTo(714,310);g.lineTo(1224,720);g.lineTo(56,720);g.closePath();g.fill();
  for(let t=0;t<9;t++){const y=316+Math.pow(t/9,2)*485;const y2=316+Math.pow((t+.46)/9,2)*485;if(y>720)break;const x1=640+(y-310)*.02,x2=640+(y2-310)*.02;
    g.strokeStyle='#e9d1a7';g.lineWidth=2+(y/720)*6;g.beginPath();g.moveTo(x1,y);g.lineTo(x2,y2);g.stroke();}
  g.strokeStyle='#d1d8cd';g.lineWidth=6;g.beginPath();g.moveTo(570,313);g.lineTo(60,720);g.moveTo(710,313);g.lineTo(1220,720);g.stroke();
  const marks=[{x:305,y:646},{x:975,y:646},{x:696,y:406},{x:584,y:406}];
  return {url:c.toDataURL('image/png'),points:marks};
}
$('demoButton').addEventListener('click',async()=>{const d=buildDemo();await readImageDataUrl(d.url,'demo-road.png',{points:d.points,width:7,length:25,hfov:75,cars:[{x:-1,y:7},{x:1.4,y:16}]});toast('Demo loaded. Points are illustrative; real calibration needs measured landmarks.');});
function drawSource(){
  if(!state.image)return;
  const sw=src.width,sh=src.height,w=state.image.naturalWidth,h=state.image.naturalHeight;
  sourceCtx.clearRect(0,0,sw,sh);sourceCtx.drawImage(state.image,0,0,sw,sh);
  const pt=p=>[p.x/w*sw,p.y/h*sh];
  if(state.points.length===4){
    sourceCtx.beginPath();state.points.forEach((p,i)=>{const [x,y]=pt(p);i?sourceCtx.lineTo(x,y):sourceCtx.moveTo(x,y);});sourceCtx.closePath();
    sourceCtx.fillStyle='#36ddaa30';sourceCtx.strokeStyle='#4be6bc';sourceCtx.lineWidth=2.5;sourceCtx.fill();sourceCtx.stroke();
  }
  if(state.inv&&validDims()){
    const drawGrid=(axis,span)=>{
      for(let v=0;v<=span+.00001;v+=5){
        const coords=axis==='x'?[[v-state.width/2,0],[v-state.width/2,state.length]]:[[-state.width/2,v],[state.width/2,v]];
        if(axis==='x'&&v>state.width)break;
        const a=project(state.inv,coords[0][0],coords[0][1]),b=project(state.inv,coords[1][0],coords[1][1]);
        if(!a||!b)continue;
        sourceCtx.beginPath();sourceCtx.moveTo(...pt(a));sourceCtx.lineTo(...pt(b));sourceCtx.strokeStyle='#f3f6a0a2';sourceCtx.lineWidth=1.3;sourceCtx.stroke();
      }
    };
    for(let y=0;y<=state.length;y+=5){
      const a=project(state.inv,-state.width/2,y),b=project(state.inv,state.width/2,y);
      if(!a||!b)continue;sourceCtx.beginPath();sourceCtx.moveTo(...pt(a));sourceCtx.lineTo(...pt(b));sourceCtx.strokeStyle='#f3f6a0a2';sourceCtx.lineWidth=1.2;sourceCtx.stroke();
    }
    for(const car of state.cars){const p=project(state.inv,car.x,car.y);if(!p)continue;const [x,y]=pt(p);sourceCtx.fillStyle='#70b9ff';sourceCtx.beginPath();sourceCtx.arc(x,y,6,0,Math.PI*2);sourceCtx.fill();sourceCtx.strokeStyle='white';sourceCtx.lineWidth=1;sourceCtx.stroke();}
  }
  state.points.forEach((p,i)=>{
    const [x,y]=pt(p),r=i===state.selected?13:10;sourceCtx.beginPath();sourceCtx.arc(x,y,r,0,2*Math.PI);
    sourceCtx.fillStyle=i===state.selected?'#f5b75e':'#39d9b4';sourceCtx.fill();sourceCtx.strokeStyle='#092023';sourceCtx.lineWidth=3;sourceCtx.stroke();
    sourceCtx.fillStyle='#092023';sourceCtx.font='bold 13px system-ui';sourceCtx.textAlign='center';sourceCtx.textBaseline='middle';sourceCtx.fillText(String(i+1),x,y);
  });
}
function updatePointList(){
  $('pointList').replaceChildren(...names.map((name,i)=>{const row=document.createElement('button');row.type='button';row.className='point-row'+(state.selected===i?' selected':'');row.style.width='100%';row.style.cursor='pointer';row.style.textAlign='left';const dot=document.createElement('span');dot.className='point-dot';dot.textContent=i+1;const n=document.createElement('span');n.className='point-name';n.textContent=name;const coord=document.createElement('span');coord.className='coords';const p=state.points[i];coord.textContent=p?Math.round(p.x)+', '+Math.round(p.y):'—';row.append(dot,n,coord);row.addEventListener('click',()=>{state.selected=i;updatePointList();drawSource();});return row;}));
}
function updateChecks(messages){
  $('checks').replaceChildren(...messages.map(m=>{const el=document.createElement('div');el.className='check-item'+(m.level==='good'?'':' warn');const icon=document.createElement('span');icon.className='check-icon';icon.textContent=m.level==='good'?'✓':m.level==='error'?'✕':'!';const txt=document.createElement('span');txt.textContent=m.text;el.append(icon,txt);return el;}));
}
function recompute(){
  updatePointList();
  let messages=[],isValid=false;
  if(!state.image){drawSource();return;}
  const w=state.image.naturalWidth,h=state.image.naturalHeight;
  if(!validDims()){messages=[{level:'error',text:'Width must be 0–200 m and length 0–500 m, both positive.'}];}
  else messages=validate(state.points,state.width,state.length,w,h);
  if(!messages.some(m=>m.level==='error')){
    try{
      state.H=calculateHomography(state.points,worldCorners(state.width,state.length));state.inv=invert3(state.H);
      state.pose=estimateCamera(state.H,w,h,state.hfov);
      // Reject solutions whose denominator crosses zero inside the road footprint.
      const denominators=state.points.map(p=>state.H[2][0]*p.x+state.H[2][1]*p.y+state.H[2][2]);
      if(denominators.some(v=>Math.abs(v)<1e-9)||Math.min(...denominators)*Math.max(...denominators)<0)throw Error('The transform crosses the projective horizon inside the marked road.');
      isValid=true;
      messages.push({level:'good',text:'3×3 matrix ready. Output coordinates use meters (X right, Y away).'});
      if(!state.pose)messages.push({level:'warn',text:'3D camera pose could not be estimated from the assumed field of view.'});
      else if(state.pose.position.z>50)messages.push({level:'warn',text:'Estimated camera height exceeds 50 m; recheck FOV and ground points.'});
      if(state.width<3)messages.push({level:'warn',text:'Road is under 3 m wide, too narrow for typical cars shown in 3D.'});
    }catch(err){messages.push({level:'error',text:err.message});}
  }
  if(!isValid){state.H=null;state.inv=null;state.pose=null;}
  updateChecks(messages);
  $('overallStatus').textContent=isValid?'Solvable · verify physical scale':'Calibration needs adjustment';
  $('overallStatus').className='status '+(isValid?'status-warn':'status-muted');
  for(const id of ['exportCfg','exportProject','exportBev','addCar','clearCars','reset3d'])$(id).disabled=!isValid;
  $('bevSizeLabel').textContent=validDims()?state.width+' × '+state.length+' m':'METERS';
  drawSource();
  $('cameraEstimate').textContent=state.pose?'Approx. camera height: '+state.pose.position.z.toFixed(2)+' m (assumed '+state.hfov+'° FOV)':'Camera pose depends on assumed lens FOV.';
  updateScene();
  clearTimeout(state.renderTimer);
  if(isValid)state.renderTimer=setTimeout(renderBev,state.dragging>=0?220:30);
  else{bevCtx.clearRect(0,0,bev.width,bev.height);$('measureResult').textContent='—';}
}
function updateScene(){state.scene?.update({width:state.width,length:state.length,cars:state.cars,pose:state.pose});state.scene?.setAddMode(state.addCar);}
function bevXY(p){return {x:(p.x+state.width/2)/state.width*bev.width,y:(1-p.y/state.length)*bev.height};}
function canvasPoint(event,canvas){const r=canvas.getBoundingClientRect();return {x:(event.clientX-r.left)*canvas.width/r.width,y:(event.clientY-r.top)*canvas.height/r.height};}
function worldAtBev(event){const p=canvasPoint(event,bev);return {x:(p.x/bev.width-.5)*state.width,y:(1-p.y/bev.height)*state.length};}
function insideWorld(p){return Math.abs(p.x)<=state.width/2&&p.y>=0&&p.y<=state.length;}
function renderBev(){
  if(!state.H||!state.imagePixels||!validDims())return;
  const ppm=Math.min(80,650/state.width,820/state.length),w=clamp(Math.round(state.width*ppm),24,650),h=clamp(Math.round(state.length*ppm),24,820);
  bev.width=w;bev.height=h;
  const pixels=bevCtx.createImageData(w,h),out=pixels.data,im=state.imagePixels;
  const sx=im.width/state.image.naturalWidth,sy=im.height/state.image.naturalHeight;
  const inv=state.inv;
  for(let j=0;j<h;j++){
    const Y=state.length*(1-(j+.5)/h);
    for(let i=0;i<w;i++){
      const X=state.width*((i+.5)/w-.5),q=project(inv,X,Y),off=(j*w+i)*4;
      if(!q){out[off]=12;out[off+1]=23;out[off+2]=35;out[off+3]=255;continue;}
      const x=q.x*sx-.5,y=q.y*sy-.5;
      if(x<0||y<0||x>=im.width-1||y>=im.height-1){out[off]=12;out[off+1]=23;out[off+2]=35;out[off+3]=255;continue;}
      const xi=Math.floor(x),yi=Math.floor(y),fx=x-xi,fy=y-yi,a=(yi*im.width+xi)*4,b=a+4,c=a+im.width*4,d=c+4;
      for(let k=0;k<3;k++)out[off+k]=Math.round((im.data[a+k]*(1-fx)+im.data[b+k]*fx)*(1-fy)+(im.data[c+k]*(1-fx)+im.data[d+k]*fx)*fy);
      out[off+3]=255;
    }
  }
  bevCtx.putImageData(pixels,0,0);
  bevCtx.lineWidth=1.3;
  for(let y=0;y<=state.length+1e-8;y+=5){const py=(1-y/state.length)*h;bevCtx.strokeStyle='#a5fffbb0';bevCtx.beginPath();bevCtx.moveTo(0,py);bevCtx.lineTo(w,py);bevCtx.stroke();bevCtx.fillStyle='#e3fff5';bevCtx.font='bold 11px system-ui';bevCtx.fillText(y+' m',7,clamp(py-5,12,h-5));}
  for(let x=-state.width/2;x<=state.width/2+1e-8;x+=1){const px=(x+state.width/2)/state.width*w;bevCtx.strokeStyle='#ddfff13c';bevCtx.beginPath();bevCtx.moveTo(px,0);bevCtx.lineTo(px,h);bevCtx.stroke();}
  bevCtx.strokeStyle='#4bebb7';bevCtx.lineWidth=3;bevCtx.strokeRect(1.5,1.5,w-3,h-3);
  for(let i=0;i<state.cars.length;i++){
    const p=bevXY(state.cars[i]),cw=Math.max(10,1.8/state.width*w),ch=Math.max(17,4.3/state.length*h);
    bevCtx.save();bevCtx.translate(p.x,p.y);bevCtx.fillStyle=['#66aaff','#ff9e6e','#b3db7d','#c7a1fa'][i%4];bevCtx.strokeStyle='#f3f8ff';bevCtx.lineWidth=1.3;
    bevCtx.fillRect(-cw/2,-ch/2,cw,ch);bevCtx.strokeRect(-cw/2,-ch/2,cw,ch);bevCtx.fillStyle='#1e3551';bevCtx.fillRect(-cw*.36,-ch*.32,cw*.72,ch*.24);bevCtx.restore();
  }
  if(state.measurement.length){
    const a=bevXY(state.measurement[0]);
    if(state.measurement.length===2){const b=bevXY(state.measurement[1]);bevCtx.strokeStyle='#ffdd85';bevCtx.lineWidth=3;bevCtx.beginPath();bevCtx.moveTo(a.x,a.y);bevCtx.lineTo(b.x,b.y);bevCtx.stroke();bevCtx.fillStyle='#ffdd85';bevCtx.font='bold 15px system-ui';const dist=Math.hypot(state.measurement[0].x-state.measurement[1].x,state.measurement[0].y-state.measurement[1].y);bevCtx.fillText(dist.toFixed(2)+' m',clamp((a.x+b.x)/2+6,2,w-90),clamp((a.y+b.y)/2-8,14,h-3));}
    for(const pt of state.measurement){const p=bevXY(pt);bevCtx.beginPath();bevCtx.arc(p.x,p.y,4,0,2*Math.PI);bevCtx.fillStyle='#ffdb78';bevCtx.fill();}
  }
  $('measureResult').textContent=state.measurement.length===2?Math.hypot(state.measurement[0].x-state.measurement[1].x,state.measurement[0].y-state.measurement[1].y).toFixed(2)+' m':'Tap 2 points';
}
function imageAtEvent(e){const r=src.getBoundingClientRect();return {x:clamp((e.clientX-r.left)/r.width*state.image.naturalWidth,0,state.image.naturalWidth),y:clamp((e.clientY-r.top)/r.height*state.image.naturalHeight,0,state.image.naturalHeight)};}
src.addEventListener('pointerdown',e=>{
  if(!state.image)return;e.preventDefault();src.setPointerCapture(e.pointerId);
  const p=imageAtEvent(e),r=src.getBoundingClientRect(),rx=state.image.naturalWidth/r.width,ry=state.image.naturalHeight/r.height;
  const distances=state.points.map(q=>Math.hypot((q.x-p.x)/rx,(q.y-p.y)/ry));
  const idx=distances.indexOf(Math.min(...distances));
  if(state.addCar&&state.H){const world=project(state.H,p.x,p.y);if(world&&insideWorld(world))placeCar(world);else toast('Choose a point on the calibrated road.');return;}
  state.dragging=distances[idx]<29?idx:state.selected;state.selected=state.dragging;state.points[state.dragging]=p;recompute();
});
src.addEventListener('pointermove',e=>{if(state.dragging<0||!state.image)return;state.points[state.dragging]=imageAtEvent(e);recompute();});
function endSource(){if(state.dragging>=0){state.dragging=-1;recompute();}}
src.addEventListener('pointerup',endSource);src.addEventListener('pointercancel',endSource);
bev.addEventListener('pointerdown',e=>{
  if(!state.H)return;e.preventDefault();bev.setPointerCapture(e.pointerId);
  const p=worldAtBev(e);
  if(!insideWorld(p))return;
  if(state.addCar){placeCar(p);return;}
  const r=bev.getBoundingClientRect();const idx=state.cars.findIndex(c=>Math.hypot((c.x-p.x)/state.width*r.width,(c.y-p.y)/state.length*r.height)<24);
  if(idx>=0){state.dragCar=idx;state.cars[idx]=p;renderBev();updateScene();return;}
  if(state.measurement.length>=2)state.measurement=[];
  state.measurement.push(p);renderBev();
});
bev.addEventListener('pointermove',e=>{if(state.dragCar<0||!state.H)return;const p=worldAtBev(e);state.cars[state.dragCar]={x:clamp(p.x,-state.width/2,state.width/2),y:clamp(p.y,0,state.length)};renderBev();updateScene();});
bev.addEventListener('pointerup',()=>{state.dragCar=-1;});bev.addEventListener('pointercancel',()=>{state.dragCar=-1;});
function placeCar(p){if(!state.H||!insideWorld(p))return;state.cars.push({x:p.x,y:p.y});setCarMode(false);renderBev();drawSource();updateScene();toast('Car placed at '+p.x.toFixed(1)+' m X, '+p.y.toFixed(1)+' m Y.');}
function setCarMode(enabled){state.addCar=enabled;$('addCar').textContent=enabled?'Cancel placing car':'+ Place car';$('addCar').classList.toggle('button-primary',enabled);state.scene?.setAddMode(enabled);}
$('addCar').addEventListener('click',()=>setCarMode(!state.addCar));
$('clearCars').addEventListener('click',()=>{state.cars=[];setCarMode(false);drawSource();renderBev();updateScene();});
$('reset3d').addEventListener('click',()=>state.scene?.reset());
$('widthMeters').addEventListener('input',dimensions);$('lengthMeters').addEventListener('input',dimensions);
$('hfov').addEventListener('input',()=>{state.hfov=Number($('hfov').value);$('fovValue').textContent=state.hfov+'°';recompute();});
document.addEventListener('keydown',e=>{
  if(!state.image||e.target.closest('input,button,dialog,textarea'))return;
  const delta={ArrowLeft:[-1,0],ArrowRight:[1,0],ArrowUp:[0,-1],ArrowDown:[0,1]}[e.key];if(!delta)return;
  e.preventDefault();const p=state.points[state.selected],step=e.shiftKey?10:1;
  p.x=clamp(p.x+delta[0]*step,0,state.image.naturalWidth);p.y=clamp(p.y+delta[1]*step,0,state.image.naturalHeight);recompute();
});
$('exportCfg').addEventListener('click',()=>{if(state.H)download('homography_matrix_manual.cfg',matrixToCfg(state.H),'text/plain');});
$('exportBev').addEventListener('click',()=>{if(!state.H)return;renderBev();bev.toBlob(blob=>{if(!blob)return;const a=document.createElement('a'),url=URL.createObjectURL(blob);a.href=url;a.download='road-bev.png';a.click();setTimeout(()=>URL.revokeObjectURL(url),1500);},'image/png');});
$('exportProject').addEventListener('click',()=>{
  if(!state.H)return;
  const payload={format:'groundlab-project-v1',calibration:{points:state.points.map(p=>({x:p.x,y:p.y})),widthMeters:state.width,lengthMeters:state.length,hfovDegrees:state.hfov,homographyImageToWorld:state.H,cars:state.cars},image:{name:state.imageName,width:state.image.naturalWidth,height:state.image.naturalHeight,dataUrl:state.dataUrl},note:'All points are original image pixels. Matrix outputs X,Y in metres; 3D camera pose depends on assumed FOV.'};
  download('groundlab-calibration.json',JSON.stringify(payload,null,2),'application/json');
});
$('projectLoadButton').addEventListener('click',()=>$('projectInput').click());
$('projectInput').addEventListener('change',async e=>{
  const file=e.target.files?.[0];if(!file)return;
  try{if(file.size>40*1024*1024)throw Error('Project is too large (max 40 MB).');
    const obj=JSON.parse(await file.text());if(obj.format!=='groundlab-project-v1')throw Error('Unsupported project format.');
    const c=obj.calibration,i=obj.image;
    if(!c||!i||!Array.isArray(c.points)||c.points.length!==4||!c.points.every(p=>Number.isFinite(p.x)&&Number.isFinite(p.y))||!Array.isArray(c.cars))throw Error('Incomplete calibration file.');
    const width=Number(c.widthMeters),length=Number(c.lengthMeters),hfov=Number(c.hfovDegrees);
    if(!(width>0&&width<=200&&length>0&&length<=500&&hfov>=25&&hfov<=130))throw Error('Invalid project dimensions.');
    const cars=c.cars.slice(0,100).filter(p=>Number.isFinite(p.x)&&Number.isFinite(p.y)&&Math.abs(p.x)<=width/2&&p.y>=0&&p.y<=length);
    await readImageDataUrl(i.dataUrl,typeof i.name==='string'?i.name.slice(0,100):'restored-image',{points:c.points,width,length,hfov,cars,expectedImageWidth:i.width,expectedImageHeight:i.height});
    toast('Project restored.');}catch(err){toast('Import failed: '+err.message);}
  e.target.value='';
});
function tutorialDiagram(type){
  const generic='<defs><linearGradient id="road" x1="0" x2="1" y1="0" y2="1"><stop stop-color="#264c5d"/><stop offset="1" stop-color="#132231"/></linearGradient></defs>';
  if(type==='image')return '<svg viewBox="0 0 480 180" aria-hidden="true">'+generic+'<rect width="480" height="180" rx="13" fill="#253f52"/><path d="M200 35 L280 35 460 180 20 180Z" fill="#53606a"/><path d="M238 37 L210 180 M242 37 L270 180" stroke="#e2e4bb" stroke-width="3" stroke-dasharray="14 11"/><text x="25" y="30" fill="#b4fce1" font-size="14" font-weight="bold">Original camera frame</text></svg>';
  if(type==='quad')return '<svg viewBox="0 0 480 180" aria-hidden="true">'+generic+'<path d="M190 40 300 40 435 166 45 166Z" fill="#2d4c59"/><path d="M95 140 385 140 283 60 197 60Z" fill="#49dfaf33" stroke="#49dfaf" stroke-width="3"/>'+[[95,140,1],[385,140,2],[283,60,3],[197,60,4]].map(([x,y,n])=>'<circle cx="'+x+'" cy="'+y+'" r="13" fill="#47e2b5"/><text x="'+x+'" y="'+(y+4)+'" text-anchor="middle" fill="#10332b" font-size="12" font-weight="bold">'+n+'</text>').join('')+'</svg>';
  if(type==='measure'||type==='bev')return '<svg viewBox="0 0 480 180" aria-hidden="true"><rect x="130" y="10" width="220" height="160" rx="8" fill="#344c5e" stroke="#52dcb1" stroke-width="2"/>'+[44,76,108,140].map(y=>'<path d="M130 '+y+' H350" stroke="#a8f7e8" opacity=".65"/>').join('')+'<path d="M240 10V170" stroke="#fff" stroke-width="3" stroke-dasharray="10 10"/><text x="356" y="94" fill="#e9f7ff" font-size="13">25 m</text><text x="233" y="178" fill="#e9f7ff" font-size="12">7 m</text></svg>';
  if(type==='scene')return '<svg viewBox="0 0 480 180" aria-hidden="true"><path d="M125 150 385 150 290 57 170 57Z" fill="#345568" stroke="#50d6b4" stroke-width="2"/><path d="M245 50V145" stroke="#e5efeb" stroke-width="2" stroke-dasharray="9 10"/><rect x="210" y="110" width="38" height="24" rx="4" fill="#77a7fa"/><rect x="263" y="70" width="20" height="14" rx="3" fill="#f2a07e"/><circle cx="80" cy="38" r="12" fill="#ffc17c"/><path d="M80 38 125 150M80 38 385 150M80 38 170 57M80 38 290 57" stroke="#ffc17c" opacity=".66"/><text x="95" y="30" fill="#ffe5bd" font-size="13">Camera</text></svg>';
  return '<svg viewBox="0 0 480 180" aria-hidden="true"><rect x="65" y="25" width="350" height="130" rx="11" fill="#182c3b" stroke="#487b71"/><text x="85" y="57" font-family="monospace" fill="#9ef5d7" font-size="15">homography_matrix_manual.cfg</text><text x="85" y="89" font-family="monospace" fill="#b6d1df" font-size="14">0.00315, -0.07297, 27.30898</text><text x="85" y="111" font-family="monospace" fill="#b6d1df" font-size="14">-0.00759, -0.02109, 18.35145</text><text x="85" y="133" font-family="monospace" fill="#b6d1df" font-size="14">-0.00011, -0.00297, 1.00000</text></svg>';
}
function showTutorial(){const i=state.tutorialIndex,step=tutorialSteps[i];$('tutorialStep').textContent='STEP '+(i+1)+' / '+tutorialSteps.length;$('tutorialTitle').textContent=step.title;$('tutorialBody').textContent=step.body;$('tutorialWarning').textContent=step.warning;$('tutorialDiagram').innerHTML=tutorialDiagram(step.diagram);$('tutorialBack').disabled=i===0;$('tutorialNext').textContent=i===tutorialSteps.length-1?'Finish ✓':'Next →';}
function openTutorial(){state.tutorialIndex=0;showTutorial();$('tutorial').showModal();}
$('guideOpen').addEventListener('click',openTutorial);$('guideBottom').addEventListener('click',openTutorial);
$('guideClose').addEventListener('click',()=>$('tutorial').close());
$('tutorialBack').addEventListener('click',()=>{state.tutorialIndex=Math.max(0,state.tutorialIndex-1);showTutorial();});
$('tutorialNext').addEventListener('click',()=>{if(state.tutorialIndex===tutorialSteps.length-1)$('tutorial').close();else{state.tutorialIndex++;showTutorial();}});
$('tutorial').addEventListener('click',e=>{if(e.target===$('tutorial'))$('tutorial').close();});
updatePointList();updateChecks([{level:'warn',text:'Upload a camera background or try the demo to begin.'}]);
import('./scene3d.js').then(({createScene})=>{state.scene=createScene($('scene3d'),placeCar);if(state.H)updateScene();else state.scene.update({width:7,length:25,cars:[],pose:null});}).catch(e=>{$('sceneMessage').textContent='3D renderer unavailable. Check internet access, WebGL and third-party CDN availability. Calibration and BEV still work.';console.warn('3D unavailable',e);});
