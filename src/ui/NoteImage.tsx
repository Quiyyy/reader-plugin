import type { ImageMark } from '../shared/workspace';
import { useState } from 'react';

const colors={red:'#b83d35',blue:'#326db5',green:'#34835c',yellow:'#a37812'};
export function NoteImage({src,marks=[]}:{src:string;marks?:ImageMark[]}) {
  const [size,setSize]=useState({width:1000,height:1000});
  return <div className="note-image-stage"><img src={src} alt="笔记截图" onLoad={e=>setSize({width:e.currentTarget.naturalWidth,height:e.currentTarget.naturalHeight})}/>{marks.length>0&&<svg className="note-image-marks" viewBox={`0 0 ${size.width} ${size.height}`} preserveAspectRatio="none" role="img" aria-label="截图标注">{marks.map((mark,index)=>{
    const color=colors[mark.color],x=mark.x*size.width,y=mark.y*size.height;
    if(mark.kind==='rect'||mark.kind==='highlight')return <rect key={index} x={x} y={y} width={mark.width*size.width} height={mark.height*size.height} fill={mark.kind==='highlight'?color:'none'} fillOpacity={mark.kind==='highlight'?.22:1} stroke={color} strokeWidth="2" vectorEffect="non-scaling-stroke"/>;
    if(mark.kind==='label')return null;
    const x2=mark.x2*size.width,y2=mark.y2*size.height,angle=Math.atan2(y2-y,x2-x),length=Math.max(10,size.width*.02);
    return <g key={index} stroke={color} strokeWidth="2" fill="none"><line x1={x} y1={y} x2={x2} y2={y2} vectorEffect="non-scaling-stroke"/><path d={`M${x2-length*Math.cos(angle-.5)},${y2-length*Math.sin(angle-.5)} L${x2},${y2} L${x2-length*Math.cos(angle+.5)},${y2-length*Math.sin(angle+.5)}`} vectorEffect="non-scaling-stroke"/></g>;
  })}</svg>}{marks.map((mark,index)=>mark.kind==='label'&&<span className="note-image-label" key={index} style={{top:`${mark.y*100}%`,...(mark.x>.65?{right:`${(1-mark.x)*100}%`}:{left:`${mark.x*100}%`}),color:colors[mark.color]}}>{mark.text}</span>)}</div>;
}

export async function annotatedImage(data:string,marks:ImageMark[]):Promise<Uint8Array> {
  const image=new Image();image.src='data:image/png;base64,'+data;await image.decode();
  const canvas=document.createElement('canvas');canvas.width=image.naturalWidth;canvas.height=image.naturalHeight;const ctx=canvas.getContext('2d')!,w=canvas.width,h=canvas.height;
  ctx.drawImage(image,0,0);ctx.lineWidth=Math.max(2,w*.003);
  for(const mark of marks){const x=mark.x*w,y=mark.y*h,color=colors[mark.color];ctx.strokeStyle=color;ctx.fillStyle=color;
    if(mark.kind==='rect')ctx.strokeRect(x,y,mark.width*w,mark.height*h);
    else if(mark.kind==='highlight'){ctx.globalAlpha=.22;ctx.fillRect(x,y,mark.width*w,mark.height*h);ctx.globalAlpha=1;ctx.strokeRect(x,y,mark.width*w,mark.height*h);}
    else if(mark.kind==='arrow'){const x2=mark.x2*w,y2=mark.y2*h,angle=Math.atan2(y2-y,x2-x),length=Math.max(10,w*.02);ctx.beginPath();ctx.moveTo(x,y);ctx.lineTo(x2,y2);ctx.moveTo(x2-length*Math.cos(angle-.5),y2-length*Math.sin(angle-.5));ctx.lineTo(x2,y2);ctx.lineTo(x2-length*Math.cos(angle+.5),y2-length*Math.sin(angle+.5));ctx.stroke();}
    else {ctx.font=`${Math.max(14,w*.027)}px sans-serif`;ctx.textBaseline='top';ctx.textAlign=mark.x>.65?'right':'left';ctx.strokeStyle='white';ctx.strokeText(mark.text,x,y,w*.8);ctx.fillText(mark.text,x,y,w*.8);}
  }
  return Uint8Array.from(atob(canvas.toDataURL('image/png').split(',')[1]!),c=>c.charCodeAt(0));
}
