// Local, dependency-free Word export. The package contains text and styles only.
export const DOCX_MIME='application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const XML_HEADER='<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
const W='http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const REL='http://schemas.openxmlformats.org/package/2006/relationships';
const OFFICE_REL='http://schemas.openxmlformats.org/officeDocument/2006/relationships/';
const encoder=new TextEncoder();

function xmlText(value,label){
 if(typeof value!=='string')throw new TypeError(`${label}必须是文字`);
 let at=0;
 for(const char of value){
  const n=char.codePointAt(0);
  if(!(n===9||n===10||n===13||(n>=0x20&&n<=0xd7ff)||(n>=0xe000&&n<=0xfffd)||(n>=0x10000&&n<=0x10ffff)))throw new Error(`${label}包含不能写入 DOCX 的字符（U+${n.toString(16).toUpperCase().padStart(4,'0')}，位置${at+1}）`);
  at+=char.length;
 }
 return value.replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[char]));
}

const CRC_TABLE=Uint32Array.from({length:256},(_,n)=>{for(let i=0;i<8;i++)n=(n>>>1)^((n&1)?0xedb88320:0);return n>>>0});
function crc32(bytes){let crc=0xffffffff;for(const byte of bytes)crc=(crc>>>8)^CRC_TABLE[(crc^byte)&255];return (crc^0xffffffff)>>>0}
function concat(parts){
 const size=parts.reduce((n,part)=>n+part.length,0);
 if(size>0xffffffff)throw new Error('剧本过大，请分集导出 DOCX');
 const bytes=new Uint8Array(size);let at=0;for(const part of parts){bytes.set(part,at);at+=part.length}return bytes;
}
export function zipStore(entries){
 const locals=[],directory=[];let offset=0;
 if(entries.length>0xffff)throw new Error('DOCX 文件数量超限');
 for(const [path,content] of entries){
  const name=encoder.encode(path),data=content instanceof Uint8Array?content:encoder.encode(content),crc=crc32(data);
  if(name.length>0xffff||data.length>0xffffffff)throw new Error('剧本过大，请分集导出 DOCX');
  const local=new Uint8Array(30),l=new DataView(local.buffer);
  l.setUint32(0,0x04034b50,true);l.setUint16(4,20,true);l.setUint16(6,0x800,true);l.setUint16(12,33,true);
  l.setUint32(14,crc,true);l.setUint32(18,data.length,true);l.setUint32(22,data.length,true);l.setUint16(26,name.length,true);
  locals.push(local,name,data);
  const central=new Uint8Array(46),c=new DataView(central.buffer);
  c.setUint32(0,0x02014b50,true);c.setUint16(4,20,true);c.setUint16(6,20,true);c.setUint16(8,0x800,true);c.setUint16(14,33,true);
  c.setUint32(16,crc,true);c.setUint32(20,data.length,true);c.setUint32(24,data.length,true);c.setUint16(28,name.length,true);c.setUint32(42,offset,true);
  directory.push(central,name);offset+=local.length+name.length+data.length;
  if(offset>0xffffffff)throw new Error('剧本过大，请分集导出 DOCX');
 }
 const central=concat(directory),end=new Uint8Array(22),e=new DataView(end.buffer);
 e.setUint32(0,0x06054b50,true);e.setUint16(8,entries.length,true);e.setUint16(10,entries.length,true);e.setUint32(12,central.length,true);e.setUint32(16,offset,true);
 return concat([...locals,central,end]);
}

const FONT='<w:rFonts w:ascii="宋体" w:hAnsi="宋体" w:eastAsia="宋体" w:cs="宋体" w:hint="eastAsia"/>';
const RUN=FONT+'<w:b w:val="0"/><w:bCs w:val="0"/><w:i w:val="0"/><w:iCs w:val="0"/><w:color w:val="000000"/><w:spacing w:val="0"/><w:w w:val="100"/><w:sz w:val="24"/><w:szCs w:val="24"/><w:position w:val="0"/><w:lang w:val="zh-CN" w:eastAsia="zh-CN"/>';
const PARAGRAPH='<w:keepNext w:val="0"/><w:keepLines w:val="0"/><w:pageBreakBefore w:val="0"/><w:spacing w:before="0" w:after="0" w:line="360" w:lineRule="auto"/><w:ind w:left="0" w:right="0" w:firstLine="0"/><w:jc w:val="left"/>';
function isHeading(line){
 const text=line.trim();
 return /^第[一二三四五六七八九十百千万零〇两\d]+[集话回](?:\s|[：:、.．—–－-]|$)/u.test(text)||/^(?:第[一二三四五六七八九十百千万零〇两\d]+场(?:\s|[：:]|$)|(?:场景|场次)[：:]|[\d０-９]+[-—–－][\d０-９]+(?:\s|[：:.．、]|$)|(?:内景|外景|INT\.|EXT\.)(?:\s|[：:]|$))/iu.test(text);
}
function paragraphs(script){
 // A plain-text line remains one paragraph, including every empty and final line.
 return script.split(/\r\n|\r|\n/).map(line=>{
  const heading=isHeading(line),run=heading?RUN.replace('<w:b w:val="0"/><w:bCs w:val="0"/>','<w:b w:val="1"/><w:bCs w:val="1"/>'):RUN;
  const paragraph=heading?PARAGRAPH.replace('<w:keepNext w:val="0"/>','<w:keepNext w:val="1"/>'):PARAGRAPH;
  const text=line.split('\t').map(part=>`<w:t xml:space="preserve">${xmlText(part,'剧本')}</w:t>`).join('<w:tab/>');
  return `<w:p><w:pPr><w:pStyle w:val="Normal"/>${paragraph}<w:rPr>${run}</w:rPr></w:pPr><w:r><w:rPr>${run}</w:rPr>${text}</w:r></w:p>`;
 }).join('');
}

export function scriptDocx({title='剧本',script}={}){
 const heading=xmlText(title,'作品名');xmlText(script,'剧本');
 const document=`${XML_HEADER}<w:document xmlns:w="${W}"><w:body>${paragraphs(script)}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:right="1800" w:bottom="1440" w:left="1800" w:header="720" w:footer="720" w:gutter="0"/></w:sectPr></w:body></w:document>`;
 const styles=`${XML_HEADER}<w:styles xmlns:w="${W}"><w:docDefaults><w:rPrDefault><w:rPr>${RUN}</w:rPr></w:rPrDefault><w:pPrDefault><w:pPr>${PARAGRAPH}</w:pPr></w:pPrDefault></w:docDefaults><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/><w:pPr>${PARAGRAPH}</w:pPr><w:rPr>${RUN}</w:rPr></w:style></w:styles>`;
 const settings=`${XML_HEADER}<w:settings xmlns:w="${W}"><w:defaultTabStop w:val="720"/></w:settings>`;
 const types=`${XML_HEADER}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/><Override PartName="/word/settings.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/></Types>`;
 const rels=`${XML_HEADER}<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${OFFICE_REL}officeDocument" Target="word/document.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/></Relationships>`;
 const documentRels=`${XML_HEADER}<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${OFFICE_REL}styles" Target="styles.xml"/><Relationship Id="rId2" Type="${OFFICE_REL}settings" Target="settings.xml"/></Relationships>`;
 const core=`${XML_HEADER}<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>${heading}</dc:title></cp:coreProperties>`;
 const bytes=zipStore([['[Content_Types].xml',types],['_rels/.rels',rels],['word/document.xml',document],['word/styles.xml',styles],['word/settings.xml',settings],['word/_rels/document.xml.rels',documentRels],['docProps/core.xml',core]]);
 return new Blob([bytes],{type:DOCX_MIME});
}

export function scriptDocxFilename(title='剧本'){
 if(typeof title!=='string')throw new TypeError('作品名必须是文字');
 let name=title.replace(/[\\/:*?"<>|\u0000-\u001f\u007f]/g,'').trim().replace(/[. ]+$/g,'').replace(/\.docx$/i,'');
 name=Array.from(name).slice(0,100).join('').replace(/[. ]+$/g,'')||'剧本';
 if(/^(?:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)/i.test(name))name='_'+name;
 return `${name}.docx`;
}
