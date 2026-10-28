import test from 'node:test';
import assert from 'node:assert/strict';
import {docText,rtfText} from '../public/studio/script-legacy.mjs';
function docFixture(compressed=false){
 const b=Buffer.alloc(512*19),v=new DataView(b.buffer,b.byteOffset,b.byteLength),sector=id=>512*(id+1),set=(at,n)=>v.setUint32(at,n,true);
 b.set([0xd0,0xcf,0x11,0xe0,0xa1,0xb1,0x1a,0xe1]);v.setUint16(28,0xfffe,true);v.setUint16(30,9,true);v.setUint16(32,6,true);set(44,1);set(48,0);set(56,4096);set(60,0xfffffffe);set(68,0xfffffffe);for(let i=0;i<109;i++)set(76+4*i,0xffffffff);set(76,1);
 const fat=sector(1);for(let i=0;i<128;i++)set(fat+4*i,0xffffffff);set(fat,0xfffffffe);set(fat+4,0xfffffffd);for(let i=2;i<10;i++)set(fat+4*i,i===9?0xfffffffe:i+1);for(let i=10;i<18;i++)set(fat+4*i,i===17?0xfffffffe:i+1);
 function entry(i,name,type,start,size){const at=sector(0)+128*i,bytes=Buffer.from(name+'\0','utf16le');b.set(bytes,at);v.setUint16(at+64,bytes.length,true);b[at+66]=type;set(at+116,start);set(at+120,size)}
 entry(0,'Root Entry',5,0xfffffffe,0);entry(1,'WordDocument',2,2,4096);entry(2,'0Table',2,10,4096);
 const word=sector(2),table=sector(10);set(word+0x1a2,0);set(word+0x1a6,21);b[table]=2;set(table+1,16);set(table+5,0);set(table+9,3);set(table+15,compressed?(0x40000000|0x1000):0x800);
 b.set(compressed?Buffer.from([97,99,233]):Buffer.from('阿青。','utf16le'),word+0x800);return b;
}
test('old Word reader preserves Chinese and correctly halves compressed piece offsets',()=>{assert.equal(docText(docFixture()),'阿青。');assert.equal(docText(docFixture(true)),'acé')});
test('old Word rejects encryption, truncated chains and out-of-range offsets instead of fabricating text',()=>{const b=docFixture();b[512*3+11]=1;assert.throws(()=>docText(b),/加密/);assert.throws(()=>docText(docFixture().subarray(0,600)),/DOC/);const c=docFixture();c.writeUInt32LE(0x3fffffff,512*11+15);assert.throws(()=>docText(c),/DOC/)});
test('RTF preserves CJK Unicode, GBK runs, punctuation, newlines and skips formatting destinations',()=>{
 assert.equal(rtfText("{\\rtf1\\ansi\\ansicpg936{\\fonttbl hidden}\\u38463?\\u38738?\\par \\'b0\\'a2\\'c7\\'e0\\tab \\ldblquote 台词\\rdblquote}"),'阿青\n阿青\t“台词”');
 assert.equal(rtfText('{\\rtf1 test \\{keep\\} \\u-10179?\\u-8704?}'),'test {keep} 😀');
 assert.throws(()=>rtfText('{\\rtf1 incomplete'),/不完整/);
});
