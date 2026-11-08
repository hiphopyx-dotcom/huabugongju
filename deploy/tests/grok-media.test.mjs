import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createGrokVideoHandler} from '../lib/grok-media.mjs';

const PNG='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+Xc1sAAAAASUVORK5CYII=';
const JPEG='data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2w==';
const WEBP='data:image/webp;base64,UklGRiIAAABXRUJQVlA4IBYAAAAwAQCdASoBAAEAAwA0JaQAA3AA/vuUAAA=';
const ENV={XAI_API_KEY:'test-key',XAI_BASE_URL:'https://video.test/v1'};

function still(prefix,length){
  return prefix+'A'.repeat(length-prefix.length);
}

async function post(body,fetchImpl,env=ENV){
  const previous=globalThis.fetch;
  const calls=[];
  globalThis.fetch=fetchImpl||(async(url,options)=>{
    calls.push({url,options});
    return Response.json({request_id:'req-12345678'});
  });
  try{
    const handler=createGrokVideoHandler(env);
    const response=await handler(new Request('https://studio.test/api/pianchang-video',{
      method:'POST',
      headers:{Origin:'https://studio.test','Content-Type':'application/json'},
      body:JSON.stringify(body)
    }));
    return {response,body:await response.json(),calls};
  }finally{
    globalThis.fetch=previous;
  }
}

function sent(call){
  return JSON.parse(call.options.body);
}

test('没有参考图和尾帧时，请求体与原来一致',async()=>{
  const plain=await post({prompt:'  走路  ',duration:99,aspect:'21:9',image:PNG,lastFrame:JPEG,video:'data:video/mp4;base64,AAAA'});
  assert.equal(plain.response.status,200);
  assert.equal(plain.body.requestId,'req-12345678');
  assert.equal(plain.calls.length,1);
  assert.equal(plain.calls[0].url,'https://video.test/v1/videos/generations');
  assert.equal(plain.calls[0].options.headers.Authorization,'Bearer test-key');
  assert.deepEqual(sent(plain.calls[0]),{
    model:'grok-imagine-video-1.5',
    prompt:'走路',
    duration:15,
    aspect_ratio:'16:9',
    resolution:'720p',
    image:{url:PNG}
  });
  const text=await post({prompt:'只有文字'});
  assert.deepEqual(sent(text.calls[0]),{
    model:'grok-imagine-video-1.5',
    prompt:'只有文字',
    duration:6,
    aspect_ratio:'16:9',
    resolution:'720p'
  });
  const empty=await post({prompt:'只有文字',reference_images:[]});
  assert.deepEqual(sent(empty.calls[0]),sent(text.calls[0]));
});

test('三张参考图和尾帧按原字符串放进 videos/generations',async()=>{
  const exact=still('data:image/png;base64,',4500000);
  const {response,calls}=await post({prompt:'接上一镜',duration:8,aspect:'9:16',image:PNG,last_frame:exact,reference_images:[PNG,JPEG,WEBP]});
  assert.equal(response.status,200);
  assert.equal(calls.length,1);
  const payload=sent(calls[0]);
  assert.equal(payload.model,'grok-imagine-video-1.5');
  assert.equal(payload.resolution,'720p');
  assert.equal(payload.duration,8);
  assert.equal(payload.aspect_ratio,'9:16');
  assert.deepEqual(payload.image,{url:PNG});
  assert.equal(payload.last_frame.url.length,4500000);
  assert.equal(payload.last_frame.url,exact);
  assert.deepEqual(payload.reference_images,[{url:PNG},{url:JPEG},{url:WEBP}]);
  assert.equal(Object.hasOwn(payload,'video'),false);
  assert.equal(Object.hasOwn(payload,'lastFrame'),false);
});

test('参考图不合格时整单拒绝，并写明下标',async()=>{
  const over=still('data:image/jpeg;base64,',4500001);
  const cases=[
    [{prompt:'走',reference_images:[PNG,JPEG,WEBP,PNG]},'参考图[3]超出最多 3 张'],
    [{prompt:'走',reference_images:[PNG,'https://cdn.example/a.png']},'参考图[1]不是 PNG、JPEG 或 WebP'],
    [{prompt:'走',reference_images:['data:image/gif;base64,R0lGODlh']},'参考图[0]不是 PNG、JPEG 或 WebP'],
    [{prompt:'走',reference_images:['data:image/jpg;base64,xx']},'参考图[0]不是 PNG、JPEG 或 WebP'],
    [{prompt:'走',reference_images:[PNG,over,WEBP]},'参考图[1]太大，请换一张较小的图'],
    [{prompt:'走',reference_images:'data:image/png;base64,xx'},'参考图必须是数组'],
    [{prompt:'走',reference_images:null},'参考图必须是数组'],
    [{prompt:'走',reference_images:[PNG,12]},'参考图[1]不是 PNG、JPEG 或 WebP']
  ];
  for(const [body,error] of cases){
    const result=await post(body);
    assert.equal(result.response.status,400,error);
    assert.deepEqual(result.body,{ok:false,error});
    assert.equal(result.calls.length,0,error);
  }
});

test('尾帧不合格时整单拒绝，合格边界可以发出',async()=>{
  const bad=await post({prompt:'走',last_frame:'data:image/webp'});
  assert.equal(bad.response.status,400);
  assert.equal(bad.body.error,'尾帧不是 PNG、JPEG 或 WebP');
  assert.equal(bad.calls.length,0);
  const huge=await post({prompt:'走',last_frame:still('data:image/webp;base64,',4500001)});
  assert.equal(huge.response.status,400);
  assert.equal(huge.body.error,'尾帧太大，请换一张较小的图');
  assert.equal(huge.calls.length,0);
  const edge=still('data:image/jpeg;base64,',4500000);
  const ok=await post({prompt:'走',last_frame:edge});
  assert.equal(ok.response.status,200);
  assert.equal(sent(ok.calls[0]).last_frame.url,edge);
  assert.equal(Object.hasOwn(sent(ok.calls[0]),'reference_images'),false);
});
