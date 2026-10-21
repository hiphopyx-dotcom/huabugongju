const names=new Set(['plate-loc','黄金时刻','蓝调时刻','霓虹光','明暗对照法','丁达尔光','自然光','轮廓光','镜头光晕','硬光','柔光箱光效','逆光','电影级布光','柯达Portra 400','富士Velvia','录像带画质','监控录像','雨景镜头','8毫米胶片','35毫米胶片','夜景光辉','电影叙事','胶片颗粒','长曝光','双重曝光','暗角','色差']);
// Fixed public teaching images only. Never proxy an arbitrary URL, cookies or provider login.
export async function reference(req,fetchImage=fetch){
 const id=new URL(req.url).searchParams.get('id');
 if(req.method!=='GET'||!names.has(id))return new Response('参考图不存在',{status:404});
 try{
  const r=await fetchImage('https://sunny-terra-drift-arch.grok.me/shot-guide/'+encodeURIComponent(id)+'.jpg',{redirect:'error',signal:AbortSignal.timeout(5000)});
  if(!r.ok||!/^image\/jpeg(?:;|$)/i.test(r.headers.get('content-type')||'')||Number(r.headers.get('content-length'))>1500000)throw Error('image unavailable');
  const body=await r.arrayBuffer();if(body.byteLength>1500000)throw Error('image too large');
  return new Response(body,{headers:{'Content-Type':'image/jpeg','Cache-Control':'public, max-age=86400','X-Content-Type-Options':'nosniff'}});
 }catch{return new Response('参考图暂不可用',{status:503})}
}
