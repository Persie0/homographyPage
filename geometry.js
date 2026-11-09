/** Pure, dependency-free projective geometry. Pixel coordinates are ORIGINAL image pixels.
 * World units are metres: X right, Y away from the near edge, Z up.
 * H maps IMAGE -> WORLD, matching cv2.perspectiveTransform in traffic-counting.
 */
export function matMul(A,B){return A.map((r,i)=>r.map((_,j)=>r.reduce((s,v,k)=>s+v*B[k][j],0)));}
export function invert3(m){
  const [a,b,c]=m[0],[d,e,f]=m[1],[g,h,i]=m[2];
  const A=e*i-f*h,B=c*h-b*i,C=b*f-c*e,D=f*g-d*i,E=a*i-c*g,F=c*d-a*f,G=d*h-e*g,H=b*g-a*h,I=a*e-b*d;
  const det=a*A+b*D+c*G;
  if(!Number.isFinite(det)||Math.abs(det)<1e-15)throw Error('Degenerate homography matrix');
  return [[A,B,C],[D,E,F],[G,H,I]].map(row=>row.map(x=>x/det));
}
export function project(H,x,y){const d=H[2][0]*x+H[2][1]*y+H[2][2];if(Math.abs(d)<1e-12||!Number.isFinite(d))return null;const u=(H[0][0]*x+H[0][1]*y+H[0][2])/d,v=(H[1][0]*x+H[1][1]*y+H[1][2])/d;return Number.isFinite(u)&&Number.isFinite(v)?{x:u,y:v}:null;}
function solve(A,b){
  const n=b.length, m=A.map((row,i)=>[...row,b[i]]);
  for(let c=0;c<n;c++){
    let p=c;for(let r=c+1;r<n;r++)if(Math.abs(m[r][c])>Math.abs(m[p][c]))p=r;
    if(Math.abs(m[p][c])<1e-12||!Number.isFinite(m[p][c]))throw Error('Points do not form a usable plane');
    [m[p],m[c]]=[m[c],m[p]];
    let v=m[c][c];for(let j=c;j<=n;j++)m[c][j]/=v;
    for(let r=0;r<n;r++)if(r!==c){v=m[r][c];for(let j=c;j<=n;j++)m[r][j]-=v*m[c][j];}
  }
  return m.map(r=>r[n]);
}
function normalize(points){
  const cx=points.reduce((s,p)=>s+p.x,0)/points.length,cy=points.reduce((s,p)=>s+p.y,0)/points.length;
  const avg=points.reduce((s,p)=>s+Math.hypot(p.x-cx,p.y-cy),0)/points.length;
  if(!(avg>1e-8))throw Error('Calibration corners are too close together');
  const s=Math.SQRT2/avg;
  const T=[[s,0,-s*cx],[0,s,-s*cy],[0,0,1]];
  return {points:points.map(p=>({x:(p.x-cx)*s,y:(p.y-cy)*s})),T};
}
export function calculateHomography(source,dest){
  if(source.length!==4||dest.length!==4)throw Error('Exactly 4 corresponding corners are required');
  if(!source.every(p=>Number.isFinite(p.x)&&Number.isFinite(p.y))||!dest.every(p=>Number.isFinite(p.x)&&Number.isFinite(p.y)))throw Error('Invalid coordinates');
  const a=normalize(source),b=normalize(dest),rows=[],values=[];
  for(let i=0;i<4;i++){
    const {x,y}=a.points[i],{x:u,y:v}=b.points[i];
    rows.push([x,y,1,0,0,0,-u*x,-u*y]);values.push(u);
    rows.push([0,0,0,x,y,1,-v*x,-v*y]);values.push(v);
  }
  const t=solve(rows,values),N=[[t[0],t[1],t[2]],[t[3],t[4],t[5]],[t[6],t[7],1]];
  const H=matMul(invert3(b.T),matMul(N,a.T));
  const scale=H[2][2]||Math.hypot(...H[2]);
  if(!(Math.abs(scale)>1e-15))throw Error('Homography normalization failed');
  return H.map(row=>row.map(v=>v/scale));
}
export function worldCorners(width,length){return [{x:-width/2,y:0},{x:width/2,y:0},{x:width/2,y:length},{x:-width/2,y:length}];}
export function convexCorners(points){
  if(points.length!==4)return false;
  const crosses=points.map((p,i)=>{const a=points[(i+1)%4],b=points[(i+2)%4];return (a.x-p.x)*(b.y-a.y)-(a.y-p.y)*(b.x-a.x);});
  const min=Math.min(...crosses),max=Math.max(...crosses);
  return min>1e-4||max< -1e-4;
}
export function polygonArea(points){return Math.abs(points.reduce((sum,p,i)=>sum+p.x*points[(i+1)%points.length].y-p.y*points[(i+1)%points.length].x,0))/2;}
export function validate(source,width,length,imgW,imgH){
  const messages=[];
  if(!source||source.length!==4)messages.push({level:'error',text:'Provide all four calibration points.'});
  if(!(width>0)&&!(length>0))messages.push({level:'error',text:'Enter positive real-world dimensions.'});
  else if(!(width>0)||!(length>0))messages.push({level:'error',text:'Both width and length must be greater than zero.'});
  if(messages.some(m=>m.level==='error'))return messages;
  if(source.some(p=>p.x<0||p.y<0||p.x>imgW||p.y>imgH))messages.push({level:'error',text:'All corners must be inside the image.'});
  if(!convexCorners(source))messages.push({level:'error',text:'Corners cross, are reversed or are nearly collinear. Use near-left → near-right → far-right → far-left.'});
  if(polygonArea(source)<imgW*imgH*0.001)messages.push({level:'error',text:'Selected ground area is too small for stable calibration.'});
  if(source.some(p=>p.y<0.02*imgH))messages.push({level:'warn',text:'A corner is near the top of the image. Avoid sky and horizon.'});
  if(!messages.some(m=>m.level==='error'))messages.unshift({level:'good',text:'Four non-crossing image corners define a solvable homography.'});
  messages.push({level:'warn',text:'Four corners fit exactly: preview alone cannot verify true distance, camera intrinsics or ground flatness.'});
  return messages;
}
const dot=(a,b)=>a.reduce((s,v,i)=>s+v*b[i],0);
const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
const unit=a=>{const s=Math.hypot(...a);return s>1e-12?a.map(v=>v/s):null;};
/** Approximate camera pose from planar homography plus ASSUMED pinhole horizontal FOV.
 * Returns null when geometry or assumed FOV produces an implausible reconstruction.
 * Orientation in camera coordinates is +X right, +Y down, +Z forward.
 */
export function estimateCamera(H,imageWidth,imageHeight,hfovDegrees){
  const inv=invert3(H),f=imageWidth/(2*Math.tan(hfovDegrees*Math.PI/360));
  if(!(f>0))return null;
  const cx=imageWidth/2,cy=imageHeight/2;
  const col=j=>[(inv[0][j]-cx*inv[2][j])/f,(inv[1][j]-cy*inv[2][j])/f,inv[2][j]];
  const a=col(0),b=col(1),c=col(2);
  const scale=(Math.hypot(...a)+Math.hypot(...b))/2;
  if(!(scale>1e-10))return null;
  let r1=unit(a),r2=unit(b.map((v,i)=>v-dot(b,r1)*r1[i]));
  if(!r1||!r2)return null;
  let r3=unit(cross(r1,r2));if(!r3)return null;
  let t=c.map(v=>v/scale);
  const getC=()=>({x:-dot(r1,t),y:-dot(r2,t),z:-dot(r3,t)});
  let position=getC();
  if(position.z<0){r1=r1.map(v=>-v);r2=r2.map(v=>-v);t=t.map(v=>-v);r3=unit(cross(r1,r2));position=getC();}
  if(!Object.values(position).every(Number.isFinite)||position.z<=0)return null;
  return {position,forward:{x:r1[2],y:r2[2],z:r3[2]},up:{x:-r1[1],y:-r2[1],z:-r3[1]},focalPixels:f,approximate:true};
}
export function matrixToCfg(H){return H.map(row=>row.map(v=>v.toFixed(10)).join(',')).join('\n')+'\n';}
