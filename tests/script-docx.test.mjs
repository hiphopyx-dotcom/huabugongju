import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {DOCX_MIME,scriptDocx,scriptDocxFilename} from '../public/studio/script-docx.mjs';

function crc32(bytes){let n=0xffffffff;for(const byte of bytes){n^=byte;for(let bit=0;bit<8;bit++)n=(n>>>1)^((n&1)?0xedb88320:0)}return (n^0xffffffff)>>>0}
async function unpack(blob){
 assert.ok(blob instanceof Blob);assert.equal(blob.type,DOCX_MIME);
 const bytes=Buffer.from(await blob.arrayBuffer()),end=bytes.length-22;
 assert.equal(bytes.readUInt32LE(end),0x06054b50);assert.equal(bytes.readUInt32LE(end+4),0);assert.equal(bytes.readUInt16LE(end+20),0);
 const count=bytes.readUInt16LE(end+10);assert.equal(bytes.readUInt16LE(end+8),count);
 const start=bytes.readUInt32LE(end+16),size=bytes.readUInt32LE(end+12);assert.equal(start+size,end);
 const files=new Map();let at=start,localEnd=0;
 for(let i=0;i<count;i++){
  assert.equal(bytes.readUInt32LE(at),0x02014b50);assert.equal(bytes.readUInt16LE(at+8),0x800);assert.equal(bytes.readUInt16LE(at+10),0);
  const crc=bytes.readUInt32LE(at+16),packed=bytes.readUInt32LE(at+20),length=bytes.readUInt32LE(at+24),nameLength=bytes.readUInt16LE(at+28),extra=bytes.readUInt16LE(at+30),comment=bytes.readUInt16LE(at+32),offset=bytes.readUInt32LE(at+42),name=bytes.subarray(at+46,at+46+nameLength).toString('utf8');
  assert.equal(packed,length);assert.equal(offset,localEnd);assert.equal(bytes.readUInt32LE(offset),0x04034b50);assert.equal(bytes.readUInt16LE(offset+6),0x800);assert.equal(bytes.readUInt16LE(offset+8),0);assert.equal(bytes.readUInt16LE(offset+12),33);assert.equal(bytes.readUInt32LE(offset+14),crc);assert.equal(bytes.readUInt32LE(offset+18),packed);assert.equal(bytes.readUInt32LE(offset+22),length);assert.equal(bytes.readUInt16LE(offset+26),nameLength);
  const dataStart=offset+30+nameLength+bytes.readUInt16LE(offset+28),data=bytes.subarray(dataStart,dataStart+length);assert.equal(bytes.subarray(offset+30,offset+30+nameLength).toString('utf8'),name);assert.equal(crc32(data),crc,name+' CRC');assert.ok(!files.has(name));files.set(name,new TextDecoder('utf-8',{fatal:true}).decode(data));localEnd=dataStart+length;at+=46+nameLength+extra+comment;
 }
 assert.equal(localEnd,start);assert.equal(at,end);return files;
}

// Strictly parse the XML subset emitted by this exporter; unknown entities and malformed tags fail.
function decode(text){return text.replace(/&([^;]*);|&/g,(entity,name)=>{assert.ok(['amp','lt','gt','quot','apos'].includes(name),'invalid XML entity '+entity);return {amp:'&',lt:'<',gt:'>',quot:'"',apos:"'"}[name]})}
function xml(source){
 const root={name:'#document',children:[]},stack=[root],tokens=source.match(/<\?[\s\S]*?\?>|<[^>]*>|[^<]+/g)||[];assert.equal(tokens.join(''),source);
 for(const token of tokens){
  if(token.startsWith('<?')){assert.match(token,/^<\?xml version="1\.0" encoding="UTF-8" standalone="yes"\?>$/);continue}
  if(!token.startsWith('<')){stack.at(-1).children.push(decode(token));continue}
  assert.doesNotMatch(token,/^<!/);const tag=token.match(/^<(\/?)([A-Za-z_][\w.:-]*)([\s\S]*?)(\/?)>$/);assert.ok(tag,token);
  const [,close,name,raw,self]=tag;if(close){assert.equal(raw.trim(),'');assert.equal(self,'');assert.equal(stack.pop().name,name);continue}
  const node={name,attrs:{},children:[]};let attrs=raw;
  while(attrs.trim()){
   const match=attrs.match(/^\s+([A-Za-z_][\w.:-]*)\s*=\s*(["'])(.*?)\2/s);assert.ok(match,'invalid attributes '+attrs);assert.doesNotMatch(match[3],/</);assert.ok(!Object.hasOwn(node.attrs,match[1]));node.attrs[match[1]]=decode(match[3]);attrs=attrs.slice(match[0].length);
  }
  stack.at(-1).children.push(node);if(!self)stack.push(node);
 }
 assert.equal(stack.length,1);const elements=root.children.filter(child=>typeof child!=='string');assert.equal(elements.length,1);assert.ok(root.children.filter(child=>typeof child==='string').every(text=>!text.trim()));return elements[0];
}
const children=(node,name)=>node.children.filter(child=>typeof child!=='string'&&(!name||child.name===name));
const one=(node,name)=>{const found=children(node,name);assert.equal(found.length,1,name);return found[0]};
const all=(node,name)=>[...(node.name===name?[node]:[]),...children(node).flatMap(child=>all(child,name))];
const text=node=>node.children.map(child=>typeof child==='string'?child:text(child)).join('');
function bodyLines(doc){return children(one(doc,'w:body'),'w:p').map(p=>children(p,'w:r').map(run=>children(run).map(n=>n.name==='w:t'?text(n):n.name==='w:tab'?'\t':'').join('')).join(''))}

test('本地DOCX包目录、大小、CRC和全部XML结构有效，标题仅用于元数据',async()=>{
 assert.equal(crc32(Buffer.from('123456789')),0xcbf43926);
 const title='只在元数据《A&B》<甲>"乙"',script='第1集\n1-1 日 内 客厅\n△周宁：<开门> & "停下"。\n周宁：我知道了！😀𠮷';
 const files=await unpack(scriptDocx({title,script}));assert.deepEqual([...files.keys()],['[Content_Types].xml','_rels/.rels','word/document.xml','word/styles.xml','word/settings.xml','word/_rels/document.xml.rels','docProps/core.xml']);
 for(const source of files.values())xml(source);
 const doc=xml(files.get('word/document.xml'));assert.deepEqual(bodyLines(doc),script.split('\n'));assert.doesNotMatch(files.get('word/document.xml'),/只在元数据/);assert.equal(text(one(xml(files.get('docProps/core.xml')),'dc:title')),title);assert.match(files.get('word/document.xml'),/&lt;开门&gt; &amp; &quot;停下&quot;/);
 const types=xml(files.get('[Content_Types].xml'));for(const override of children(types,'Override'))assert.ok(files.has(override.attrs.PartName.slice(1)));
});

test('宋体小四12pt与1.5倍行距显式固定，页边距和零缩进来自参考剧本',async()=>{
 const files=await unpack(scriptDocx({title:'不加封面',script:'第1集\n1-1 日 内 客厅\n△周宁开门。\n周宁：回来了。'})),doc=xml(files.get('word/document.xml')),styles=xml(files.get('word/styles.xml'));
 assert.deepEqual(one(one(doc,'w:body'),'w:sectPr').children.filter(n=>typeof n!=='string').map(n=>[n.name,n.attrs]),[['w:pgSz',{'w:w':'11906','w:h':'16838'}],['w:pgMar',{'w:top':'1440','w:right':'1800','w:bottom':'1440','w:left':'1800','w:header':'720','w:footer':'720','w:gutter':'0'}]]);
 for(const root of [doc,styles]){
  for(const run of all(root,'w:rPr')){const font=one(run,'w:rFonts');for(const key of ['w:ascii','w:hAnsi','w:eastAsia','w:cs'])assert.equal(font.attrs[key],'宋体');assert.equal(one(run,'w:sz').attrs['w:val'],'24');assert.equal(one(run,'w:szCs').attrs['w:val'],'24');assert.equal(one(run,'w:spacing').attrs['w:val'],'0');assert.equal(one(run,'w:w').attrs['w:val'],'100')}
  for(const p of all(root,'w:pPr')){assert.deepEqual(one(p,'w:spacing').attrs,{'w:before':'0','w:after':'0','w:line':'360','w:lineRule':'auto'});assert.deepEqual(one(p,'w:ind').attrs,{'w:left':'0','w:right':'0','w:firstLine':'0'});assert.equal(one(p,'w:jc').attrs['w:val'],'left');assert.equal(one(p,'w:pageBreakBefore').attrs['w:val'],'0')}
 }
 const ps=children(one(doc,'w:body'),'w:p');for(const [i,p] of ps.entries()){assert.equal(one(one(p,'w:pPr'),'w:keepNext').attrs['w:val'],i<2?'1':'0');assert.equal(one(one(one(p,'w:r'),'w:rPr'),'w:b').attrs['w:val'],i<2?'1':'0')}
 for(const source of files.values())assert.doesNotMatch(source,/asciiTheme|hAnsiTheme|eastAsiaTheme|cstheme|<w:br|<w:headerReference|<w:footerReference/);
});

test('逐行保留前导空格、空段落、尾部换行、制表符、中文和原始markdown',async()=>{
 const script='\n  第2集\r\n\t2-1 夜 外 门口\r\n\r\n△  周宁\t开门。  \n**不要自动清理**\n```原稿```\n\t\t\n\n',files=await unpack(scriptDocx({title:'空白保真',script})),doc=xml(files.get('word/document.xml'));
 assert.deepEqual(bodyLines(doc),script.split(/\r\n|\r|\n/));assert.equal(all(doc,'w:tab').length,4);for(const t of all(doc,'w:t'))assert.equal(t.attrs['xml:space'],'preserve');
 assert.deepEqual(bodyLines(xml((await unpack(scriptDocx({script:''}))).get('word/document.xml'))),['']);
 const unicode='\uFEFF△𠮷😀：\u0085\u2028\u2029\uFFFD。';assert.deepEqual(bodyLines(xml((await unpack(scriptDocx({script:unicode}))).get('word/document.xml'))),[unicode]);
});

test('拒绝XML无法表示的控制字符和孤立代理项，不悄悄删除或替换正文',()=>{
 for(const char of ['\0','\u0001','\u000B','\u000C','\u001F','\uD800','\uDFFF','\uFFFE','\uFFFF']){assert.throws(()=>scriptDocx({title:'作品',script:'原文'+char+'保留'}),/不能写入 DOCX 的字符/);assert.throws(()=>scriptDocx({title:'作品'+char,script:'原文'}),/不能写入 DOCX 的字符/)}
 for(const script of [undefined,null,42,{},[]])assert.throws(()=>scriptDocx({script}),/剧本必须是文字/);assert.throws(()=>scriptDocx({title:42,script:'原稿'}),/作品名必须是文字/);
});

test('正文不离开浏览器，包中没有外链、可执行内容或原项目隐私字段',async()=>{
 const original=globalThis.fetch;globalThis.fetch=()=>{throw Error('export must not use network')};let files;try{files=await unpack(scriptDocx({title:'隐私',script:'△https://example.com/ 只是原文。',secret:'never-export-this',provider:'never-export-provider'}))}finally{globalThis.fetch=original}
 const module=await readFile(new URL('../public/studio/script-docx.mjs',import.meta.url),'utf8');assert.doesNotMatch(module,/\b(?:fetch|XMLHttpRequest|WebSocket|EventSource|importScripts)\s*\(|\bimport\s*(?:\(|["'{*])/);
 for(const [path,source] of files){assert.doesNotMatch(source,/never-export|TargetMode="External"|<w:hyperlink|<w:altChunk|<w:object|<w:instrText|vbaProject/i);if(path.endsWith('.rels'))for(const rel of children(xml(source),'Relationship')){assert.doesNotMatch(rel.attrs.Target,/^(?:[a-z]+:|\/)|\.\./i);assert.ok(files.has(path==='_rels/.rels'?rel.attrs.Target:'word/'+rel.attrs.Target))}}
});

test('DOCX文件名安全且不重复扩展名，支持中文和空标题',()=>{
 assert.equal(scriptDocxFilename('《剧本》 第一季'),'《剧本》 第一季.docx');assert.equal(scriptDocxFilename('  A/B:C*D?"<>|\\  '),'ABCD.docx');assert.equal(scriptDocxFilename('  '),'剧本.docx');assert.equal(scriptDocxFilename('成稿.DOCX'),'成稿.docx');assert.equal(scriptDocxFilename('CON'),'_CON.docx');assert.equal(Array.from(scriptDocxFilename('😀'.repeat(120))).length,105);
});
