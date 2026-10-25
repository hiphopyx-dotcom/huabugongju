// Approximation by UTF-8 bytes: ASCII / 4, other bytes / 3. No tokenizer or provider is exposed.
export const TEXT_OUTPUT_HOLD=21846; // ceil(64 KiB / 3), covers the server's maximum result.
export function estimateText(text=''){
 let ascii=0,other=0;for(const c of String(text)){if(c.codePointAt(0)<128)ascii++;else other+=new TextEncoder().encode(c).length;}
 return Math.ceil(ascii/4+other/3);
}
export function estimateMedia(kind,{count=1,seconds=5}={},rates={image:2000,videoSecond:1000}){
 if(!['image','video'].includes(kind))throw Error('请选择图片或视频');
 if(!Number.isInteger(count)||count<1||count>20)throw Error('数量需要1–20');
 if(kind==='video'&&(!Number.isFinite(seconds)||seconds<1||seconds>600))throw Error('视频时长需要1–600秒');
 return Math.ceil(count*(kind==='image'?rates.image:seconds*rates.videoSecond));
}
