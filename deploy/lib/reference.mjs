const names=new Set(['plate-loc','黄金时刻','蓝调时刻','霓虹光','明暗对照法','丁达尔光','自然光','轮廓光','镜头光晕','硬光','柔光箱光效','逆光','电影级布光','柯达Portra 400','富士Velvia','录像带画质','监控录像','雨景镜头','8毫米胶片','35毫米胶片','夜景光辉','电影叙事','胶片颗粒','长曝光','双重曝光','暗角','色差']);
// Legacy URLs resolve only to bundled, same-origin teaching images.
export async function reference(req){
 const id=new URL(req.url).searchParams.get('id');
 if(req.method!=='GET'||!names.has(id))return new Response('参考图不存在',{status:404});
 return new Response(null,{status:307,headers:{Location:'/shot-reference/'+encodeURIComponent(id)+'.jpg'}});
}
