import {test} from 'node:test';import assert from 'node:assert/strict';import {reference} from '../lib/reference.mjs';
test('旧教学图片地址仅跳转本站打包资源，拒绝任意代理地址',async()=>{
 const ok=await reference(new Request('https://studio.test/api/reference?id=plate-loc'));
 assert.equal(ok.status,307);assert.equal(ok.headers.get('location'),'/shot-reference/plate-loc.jpg');
 for(const id of ['https://evil.test/','../secret','不存在'])assert.equal((await reference(new Request('https://studio.test/api/reference?id='+encodeURIComponent(id)))).status,404);
 assert.equal((await reference(new Request('https://studio.test/api/reference?id=plate-loc',{method:'POST'}))).status,404);
});
