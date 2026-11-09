import test from 'node:test';
import assert from 'node:assert/strict';
import {calculateHomography,invert3,project,worldCorners,validate,estimateCamera,matrixToCfg,convexCorners} from '../geometry.js';

const source=[{x:140,y:810},{x:800,y:790},{x:520,y:270},{x:345,y:280}];
const destination=worldCorners(7,25);
const H=calculateHomography(source,destination);
const epsilon=1e-7;
function close(a,b){assert.ok(Math.abs(a-b)<epsilon,`expected ${a} ≈ ${b}`);}
test('four source corners land at measured meter coordinates',()=>{
  source.forEach((p,i)=>{const v=project(H,p.x,p.y);close(v.x,destination[i].x);close(v.y,destination[i].y);});
});
test('projection is invertible and preserves intermediate world coordinates',()=>{
  const inv=invert3(H);
  for(const p of [{x:-1.1,y:7},{x:2.2,y:13},{x:0,y:22.5}]){
    const img=project(inv,p.x,p.y),back=project(H,img.x,img.y);
    close(back.x,p.x);close(back.y,p.y);
  }
});
test('validation rejects crossing, narrow and invalid rectangles',()=>{
  assert.ok(validate(source,7,25,1280,900).every(x=>x.level!=='error'));
  const crossed=[source[0],source[2],source[1],source[3]];
  assert.ok(!convexCorners(crossed));
  assert.ok(validate(crossed,7,25,1280,900).some(x=>x.level==='error'));
  assert.ok(validate(source,0,25,1280,900).some(x=>x.level==='error'));
  assert.ok(validate([{x:1,y:1},{x:2,y:2},{x:3,y:3},{x:4,y:4}],7,25,1280,900).some(x=>x.level==='error'));
});
test('near-degenerate correspondences fail rather than exporting nonsense',()=>{
  assert.throws(()=>calculateHomography([{x:0,y:0},{x:1,y:1},{x:2,y:2},{x:3,y:3}],destination));
});
test('camera pose estimates positive height with a plausible FOV',()=>{
  const p=estimateCamera(H,1280,900,75);
  assert.ok(p&&p.position.z>0);
  assert.ok(Number.isFinite(p.position.x)&&Number.isFinite(p.position.y));
  const other=estimateCamera(H,1280,900,55);
  assert.ok(other&&Math.abs(other.position.z-p.position.z)>.01);
});
test('cfg is exactly three comma-delimited numeric rows',()=>{
  const rows=matrixToCfg(H).trim().split('\n');
  assert.equal(rows.length,3);
  for(const row of rows){assert.equal(row.split(',').length,3);assert.ok(row.split(',').every(v=>Number.isFinite(Number(v))));}
});
