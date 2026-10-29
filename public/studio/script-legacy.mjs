// Bounded, local-only readers for legacy script documents. No external uploads.
export function rtfText(raw) {
  const text=String(raw), stack=[]; let i=0,out='',skip=false,uc=1,fallback=0,encoding='windows-1252';
  while(i<text.length) {
    const ch=text[i++];
    if(ch==='{'){stack.push({skip,uc,encoding});continue}
    if(ch==='}'){const state=stack.pop();if(state)({skip,uc,encoding}=state);continue}
    if(ch!=='\\'){if(fallback)fallback--;else if(!skip&&ch!=='\r'&&ch!=='\n')out+=ch;continue}
    const c=text[i];
    if(c==="'") {
      const bytes=[];
      while(text.slice(i,i+1)==="'"&&/^[0-9a-f]{2}$/i.test(text.slice(i+1,i+3))) {bytes.push(parseInt(text.slice(i+1,i+3),16));i+=3;if(text[i]==='\\'&&text[i+1]==="'")i++;else break;}
      if(fallback)fallback=Math.max(0,fallback-bytes.length);else if(!skip)out+=new TextDecoder(encoding).decode(new Uint8Array(bytes));continue;
    }
    if(c==='*'){skip=true;i++;continue}
    if(c==='\\'||c==='{'||c==='}'){i++;if(fallback)fallback--;else if(!skip)out+=c;continue}
    const m=text.slice(i).match(/^([a-z]+)(-?\d+)? ?/i);
    if(!m){i++;if(!skip&&c==='~')out+=' ';continue}
    i+=m[0].length;const word=m[1],n=Number(m[2]);
    if(['fonttbl','colortbl','stylesheet','info','pict','object','header','footer','fldinst'].includes(word)){skip=true;continue}
    if(word==='ansicpg'){encoding=n===936?'gb18030':n===65001?'utf-8':`windows-${n}`;continue}
    if(word==='uc'){uc=Math.max(0,Math.min(16,n));continue}
    if(word==='bin'){if(!Number.isInteger(n)||n<0||n>text.length-i)throw Error('RTF 二进制内容损坏');i+=n;continue}
    if(skip)continue;
    if(word==='u'){out+=String.fromCharCode(n<0?n+65536:n);fallback=uc;}
    else if(word==='par'||word==='line')out+='\n';else if(word==='tab')out+='\t';
    else if(word==='emdash')out+='—';else if(word==='endash')out+='–';else if(word==='lquote'||word==='rquote')out+='’';else if(word==='ldblquote')out+='“';else if(word==='rdblquote')out+='”';
  }
  if(stack.length)throw Error('RTF 文档不完整，请重新另存');
  return out;
}

export function docText(input) {
  const data=new Uint8Array(input),view=new DataView(data.buffer,data.byteOffset,data.byteLength);
  const bad=()=>{throw Error('旧版 DOC 已损坏或格式不支持，请用 Word 另存为 DOCX')};
  const check=(at,n)=>{if(at<0||at+n>data.length)bad()};
  const u16=at=>{check(at,2);return view.getUint16(at,true)}, u32=at=>{check(at,4);return view.getUint32(at,true)};
  if(data.length<512||u32(0)!==0xe011cfd0||u32(4)!==0xe11ab1a1||u16(28)!==0xfffe)bad();
  const shift=u16(30),miniShift=u16(32);if(![9,12].includes(shift)||miniShift!==6)bad();
  const sectorSize=2**shift,sectorCount=Math.floor(data.length/sectorSize)-1;
  const sector=id=>{if(!Number.isInteger(id)||id<0||id>=sectorCount)bad();return data.subarray((id+1)*sectorSize,(id+2)*sectorSize)};
  const integers=bytes=>{const v=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);return Array.from({length:bytes.length/4},(_,i)=>v.getUint32(i*4,true))};
  const difat=Array.from({length:109},(_,i)=>u32(76+4*i)).filter(n=>n<0xfffffffa),seenDifat=new Set();let next=u32(68);
  for(let i=0;i<u32(72);i++){if(seenDifat.has(next))bad();seenDifat.add(next);const ids=integers(sector(next));difat.push(...ids.slice(0,-1).filter(n=>n<0xfffffffa));next=ids.at(-1);if(difat.length>sectorCount)bad()}
  if(difat.length<u32(44))bad();const fat=difat.slice(0,u32(44)).flatMap(id=>integers(sector(id)));
  const join=parts=>{const size=parts.reduce((n,p)=>n+p.length,0);if(size>24*1024*1024)bad();const out=new Uint8Array(size);let at=0;for(const p of parts){out.set(p,at);at+=p.length}return out};
  function chain(start,size=-1,table=fat,source=sector,unit=sectorSize){let id=start,left=size<0?24*1024*1024:size;const seen=new Set(),parts=[];while(id!==0xfffffffe&&left>0){if(id>=table.length||seen.has(id))bad();seen.add(id);parts.push(source(id).slice(0,Math.min(unit,left)));left-=Math.min(unit,left);id=table[id];if(seen.size>sectorCount*8)bad()}if(size>=0&&left>0)bad();return join(parts)}
  const dir=chain(u32(48)),entries=[];
  for(let at=0;at+128<=dir.length;at+=128){const v=new DataView(dir.buffer,dir.byteOffset+at,128),n=v.getUint16(64,true),type=dir[at+66];if(!type)continue;if(n<2||n>64||n%2||v.getUint32(124,true))bad();entries.push({name:new TextDecoder('utf-16le').decode(dir.subarray(at,at+n-2)),type,start:v.getUint32(116,true),size:v.getUint32(120,true)})}
  const root=entries.find(e=>e.type===5);if(!root)bad();let miniFat,miniStream;
  function read(name){const e=entries.find(e=>e.name===name);if(!e)return null;if(e.size>20*1024*1024)bad();if(e.size<u32(56)){miniFat ||= integers(chain(u32(60),u32(64)*sectorSize));miniStream ||= chain(root.start,root.size);return chain(e.start,e.size,miniFat,id=>{const at=id*64;if(at+64>miniStream.length)bad();return miniStream.subarray(at,at+64)},64)}return chain(e.start,e.size)}
  const word=read('WordDocument');if(!word||word.length<0x1aa)bad();const w=new DataView(word.buffer,word.byteOffset,word.byteLength),flags=w.getUint16(10,true);
  if(flags&0x8100)throw Error('DOC 已加密，请先解除密码并另存为 DOCX');
  const table=read(flags&0x200?'1Table':'0Table'),at=w.getUint32(0x1a2,true),length=w.getUint32(0x1a6,true);if(!table||!length||at+length>table.length)bad();
  const clx=table.subarray(at,at+length),cv=new DataView(clx.buffer,clx.byteOffset,clx.byteLength);let cursor=0,plc;
  while(cursor<clx.length){if(clx[cursor]===1){if(cursor+3>clx.length)bad();cursor+=3+cv.getUint16(cursor+1,true)}else if(clx[cursor]===2){if(cursor+5>clx.length)bad();const n=cv.getUint32(cursor+1,true);if(cursor+5+n>clx.length)bad();plc=clx.subarray(cursor+5,cursor+5+n);break}else bad()}
  if(!plc||plc.length<16||(plc.length-4)%12)bad();const pv=new DataView(plc.buffer,plc.byteOffset,plc.byteLength),count=(plc.length-4)/12,pieces=[];
  for(let i=0;i<count;i++){const chars=pv.getUint32((i+1)*4,true)-pv.getUint32(i*4,true),fc=pv.getUint32((count+1)*4+i*8+2,true),compressed=!!(fc&0x40000000),offset=compressed?(fc&0x3fffffff)/2:fc,bytes=chars*(compressed?1:2);if(chars<0||offset%1||offset+bytes>word.length)bad();pieces.push(new TextDecoder(compressed?'windows-1252':'utf-16le').decode(word.subarray(offset,offset+bytes)))}
  return pieces.join('').replace(/\r/g,'\n').replace(/\u0007/g,'\t').replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g,'');
}
