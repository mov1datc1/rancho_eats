import {supabase} from './supabase';
export const categoryIcon=(name:string,url?:string|null)=>url||'/category-icons/'+({restaurantes:'restaurantes',farmacia:'farmacia',carniceria:'carniceria',fruteria:'fruteria',pescaderia:'pescaderia',cremeria:'cremeria',tiendas:'tiendas'}[name.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim()]||'otros')+'.svg';
const svgTags=new Set(['svg','g','path','rect','circle','ellipse','line','polyline','polygon','defs','linearGradient','radialGradient','stop','clipPath','title','desc']);
const svgAttrs=new Set(['xmlns','viewBox','width','height','x','y','x1','y1','x2','y2','cx','cy','r','rx','ry','d','points','fill','stroke','stroke-width','stroke-linecap','stroke-linejoin','stroke-miterlimit','opacity','fill-opacity','stroke-opacity','transform','id','offset','stop-color','stop-opacity','gradientUnits','gradientTransform','clip-path','fill-rule','clip-rule']);
export function safeSVG(text:string){
 if(/<!DOCTYPE|<!ENTITY/i.test(text))throw Error('El SVG contiene elementos externos no permitidos.');
 const doc=new DOMParser().parseFromString(text,'image/svg+xml');if(doc.querySelector('parsererror')||doc.documentElement.localName!=='svg')throw Error('SVG inválido.');
 for(const el of Array.from(doc.querySelectorAll('*'))){if(!svgTags.has(el.localName))throw Error('Exporta el SVG con formas y trazados, sin imágenes, estilos ni scripts.');for(const a of Array.from(el.attributes)){if(!svgAttrs.has(a.name)||(/url\(/i.test(a.value)&&!/^url\(#[\w-]+\)$/.test(a.value)))throw Error('El SVG contiene atributos o referencias no permitidos.');}}
 doc.documentElement.setAttribute('width','512');doc.documentElement.setAttribute('height','512');return new XMLSerializer().serializeToString(doc);
}
export async function prepareCategoryIcon(file:File){
 if(file.size>2*1024*1024)throw Error('Máximo 2 MB.');
 if(!['image/svg+xml','image/png','image/webp','image/jpeg'].includes(file.type))throw Error('Usa SVG, PNG, WebP o JPG.');
 const blob=file.type==='image/svg+xml'?new Blob([safeSVG(await file.text())],{type:'image/svg+xml'}):file;
 const url=URL.createObjectURL(blob);try{
 const img=new Image();img.src=url;await img.decode();if(img.naturalWidth<32||img.naturalHeight<32||img.naturalWidth*img.naturalHeight>16777216)throw Error('Usa una imagen entre 32 y 4096 píxeles por lado.');
 const canvas=document.createElement('canvas');canvas.width=canvas.height=512;const ctx=canvas.getContext('2d');if(!ctx)throw Error('No se pudo procesar la imagen.');const size=512/Math.max(img.naturalWidth,img.naturalHeight);ctx.drawImage(img,(512-img.naturalWidth*size)/2,(512-img.naturalHeight*size)/2,img.naturalWidth*size,img.naturalHeight*size);
 return await new Promise<Blob>((ok,no)=>canvas.toBlob(b=>b?ok(b):no(Error('No se pudo optimizar.')),'image/png'));
 }finally{URL.revokeObjectURL(url);}
}
export async function uploadCategoryIcon(blob:Blob){const path=crypto.randomUUID()+'.png';const r=await supabase.storage.from('category-icons').upload(path,blob,{contentType:'image/png',cacheControl:'31536000'});if(r.error)throw r.error;return supabase.storage.from('category-icons').getPublicUrl(path).data.publicUrl;}
