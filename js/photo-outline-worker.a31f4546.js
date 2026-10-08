/* Four-edge candidate detector. Local advisory only; never used to crop uploads or measure grading centering. */
function detect(data,w,h) {
 const n=w*h,g=new Float32Array(n),blur=new Float32Array(n),gx=new Float32Array(n),gy=new Float32Array(n),mag=new Float32Array(n);
 for(let i=0;i<n;i++)g[i]=.299*data[i*4]+.587*data[i*4+1]+.114*data[i*4+2];
 for(let y=1;y<h-1;y++)for(let x=1;x<w-1;x++){const i=y*w+x;blur[i]=(g[i]*4+2*(g[i-1]+g[i+1]+g[i-w]+g[i+w])+g[i-w-1]+g[i-w+1]+g[i+w-1]+g[i+w+1])/16;}
 const angles=90,R=Math.ceil(Math.hypot(w,h)),bins=2*R+1,acc=new Float32Array(angles*bins),cs=[],sn=[];
 for(let a=0;a<angles;a++){cs[a]=Math.cos(a*Math.PI/angles);sn[a]=Math.sin(a*Math.PI/angles);}
 for(let y=3;y<h-3;y++)for(let x=3;x<w-3;x++){
  const i=y*w+x;
  let valid=true;for(let v=-2;v<=2;v++)for(let u=-2;u<=2;u++)if(data[((y+v)*w+x+u)*4+3]<250)valid=false;
  if(!valid)continue;
  const dx=(blur[i+1]-blur[i-1])/2,dy=(blur[i+w]-blur[i-w])/2,m=Math.hypot(dx,dy);gx[i]=dx;gy[i]=dy;mag[i]=m;if(m<9)continue;
  let a=Math.atan2(dy,dx);if(a<0)a+=Math.PI;let center=Math.round(a*angles/Math.PI)%angles;
  for(let da=-4;da<=4;da++){let t=(center+da+angles)%angles;let r=Math.round(x*cs[t]+y*sn[t])+R;acc[t*bins+r]+=Math.min(m,50);}
 }
 const peaks=[];
 for(let a=0;a<angles;a++)for(let r=0;r<bins;r++)if(acc[a*bins+r]>300)peaks.push({a,r:r-R,v:acc[a*bins+r]});
 peaks.sort((a,b)=>b.v-a.v);const lines=[];
 const ad=(a,b)=>Math.min(Math.abs(a-b),angles-Math.abs(a-b));
 for(const p of peaks){if(lines.some(q=>ad(q.a,p.a)<=4 && Math.abs(q.r-(Math.abs(q.a-p.a)>angles/2?-p.r:p.r))<7))continue;lines.push(p);if(lines.length>=40)break;}
 function intersect(a,b){const det=cs[a.a]*sn[b.a]-sn[a.a]*cs[b.a];if(Math.abs(det)<.5)return null;return {x:(a.r*sn[b.a]-b.r*sn[a.a])/det,y:(cs[a.a]*b.r-cs[b.a]*a.r)/det};}
 const pairs=[];
 for(let i=0;i<lines.length;i++)for(let j=i+1;j<lines.length;j++)if(ad(lines[i].a,lines[j].a)<=9){
  const a=lines[i],b=lines[j],flip=Math.abs(a.a-b.a)>angles/2?-1:1;
  const dist=Math.abs((a.r-w/2*cs[a.a]-h/2*sn[a.a])-flip*(b.r-w/2*cs[b.a]-h/2*sn[b.a]));
  if(dist>=35 && dist<=Math.max(w,h)*.95)pairs.push([a,b]);
 }
 const len=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y);
 function support(a,b){let hit=0,total=0,power=0;const dx=b.x-a.x,dy=b.y-a.y,L=Math.hypot(dx,dy),nx=-dy/L,ny=dx/L;
  for(let t=.08;t<=.92;t+=3/L){const x=a.x+dx*t,y=a.y+dy*t;let best=0;
   for(let d=-2;d<=2;d++){const xx=Math.round(x+nx*d),yy=Math.round(y+ny*d);if(xx<2||yy<2||xx>=w-2||yy>=h-2)continue;const i=yy*w+xx;best=Math.max(best,Math.abs(gx[i]*nx+gy[i]*ny));}
   if(best>=8)hit++;power+=Math.min(best,35);total++;
  }return {hit:hit/total,power:power/total};
 }
 let best=null;
 for(let i=0;i<pairs.length;i++)for(let j=i+1;j<pairs.length;j++){
  const A=pairs[i],B=pairs[j];if(Math.abs(ad(A[0].a,B[0].a)-45)>10)continue;
  let q=[intersect(A[0],B[0]),intersect(A[1],B[0]),intersect(A[1],B[1]),intersect(A[0],B[1])];
  if(q.some(p=>!p||p.x<5||p.y<5||p.x>w-5||p.y>h-5))continue;
  const lens=q.map((p,k)=>len(p,q[(k+1)%4]));if(Math.max(lens[0],lens[2])/Math.min(lens[0],lens[2])>1.5||Math.max(lens[1],lens[3])/Math.min(lens[1],lens[3])>1.5)continue;
  let width=(lens[0]+lens[2])/2,height=(lens[1]+lens[3])/2;if(width>height){q=[q[1],q[2],q[3],q[0]];[width,height]=[height,width];}
  const ratio=width/height;if(ratio<.57||ratio>.86)continue;
  const area=Math.abs(q.reduce((s,p,k)=>s+p.x*q[(k+1)%4].y-p.y*q[(k+1)%4].x,0))/2;
  if(area<n*.12||area>n*.78)continue;
  const cx=q.reduce((s,p)=>s+p.x,0)/4,cy=q.reduce((s,p)=>s+p.y,0)/4;if(Math.abs(cx-w/2)>w*.23||Math.abs(cy-h/2)>h*.25)continue;
  const sup=[];for(let k=0;k<4;k++){const s=support(q[k],q[(k+1)%4]);sup.push(s);if(s.hit<.65)break;}if(sup.length<4)continue;const min=Math.min(...sup.map(s=>s.hit));if(min<.65)continue;
  const mean=sup.reduce((s,a)=>s+a.hit,0)/4,power=sup.reduce((s,a)=>s+a.power,0)/4;
  const score=area**.7*min*mean*(.6+power/35)*Math.exp(-Math.abs(Math.log(ratio/(2.5/3.5)))*3);
  if(!best||score>best.score)best={q,score,min,mean,area,lines:lines.length,pairs:pairs.length};
 }
 return best;
}


function candidate(data,w,h) {
 const r=detect(data,w,h);if(!r)return null;
 const corners=r.q.map(p=>({x:p.x/w,y:p.y/h}));
 const xs=corners.map(p=>p.x),ys=corners.map(p=>p.y),x=Math.min(...xs),y=Math.min(...ys);
 return {x,y,w:Math.max(...xs)-x,h:Math.max(...ys)-y,corners,score:r.score,method:'edges'};
}
if(typeof module!=='undefined' && module.exports)module.exports={detect,candidate};
else {
 importScripts('/js/photo-guide.276e535b.js');
 self.onmessage=function(event){
  const {id,w,h,rgba}=event.data||{};
  if(!Number.isInteger(w)||!Number.isInteger(h)||w<32||h<32||w>320||h>400||!(rgba instanceof ArrayBuffer)||rgba.byteLength!==w*h*4){self.postMessage({id,box:null});return;}
  try {const data=new Uint8ClampedArray(rgba);const box=self.CardResellPhotoGuide.outline(data,w,h)||candidate(data,w,h);self.postMessage({id,box});}
  catch(_){self.postMessage({id,box:null});}
 };
}
