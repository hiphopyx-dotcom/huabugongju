// Axis data mirrors the original studio's a/b along/off/pose structure.
export const POSES=[['stand','站'],['sit','坐'],['kneel','跪'],['prone','趴'],['lie','躺']];
const clamp=(v,min,max,fallback)=>Number.isFinite(Number(v))?Math.min(max,Math.max(min,Number(v))):fallback;
export function axisBlock(raw){
 let value=raw;if(typeof value==='string')try{value=JSON.parse(value)}catch{value={}}
 return Object.fromEntries([['a',28],['b',72]].map(([who,along])=>{const v=value?.[who] || {};return [who,{along:clamp(v.along,8,92,along),off:clamp(v.off,-28,32,12),pose:POSES.some(([id])=>id===v.pose)?v.pose:'stand'}]}));
}
export function axisDistance(raw){const b=axisBlock(raw);return Math.max(.4,Math.round(Math.abs(b.a.along-b.b.along)/2)/10)}
export function axisPrompt(raw,a,b){
 if(!raw)return '保持视线轴和空间关系，不越轴。';
 if(typeof raw==='string')try{JSON.parse(raw)}catch{return raw}
 const block=axisBlock(raw),distance=axisDistance(block),camera=distance<1.1?'近机位，85mm':distance<2.2?'中机位，50mm':distance<3.4?'远机位，35mm，留出地面间距':'远机位，24mm广角，人物较小，留出明显空间';
 const pose={stand:'双脚站立',sit:'坐在同一把椅子上，正反打不得更换座椅',kneel:'双膝跪地，臀部不落座',prone:'俯卧趴着，抬头看向对方',lie:'仰卧或侧躺'};
 return [ [[a,block.a],[b,block.b]].map(([name,m])=>`${name}：${pose[m.pose]}；舞台横向 ${m.along}%，距轴线 ${m.off}%`).join('。'),`两人相距约 ${distance} 米；${camera}。正反打保持同一人物姿态、座椅、间距及180°轴线，不交换人物姿态，不因参考图站立而强行站起。`].join('。');
}
export function dummySVG(pose){
 const body={stand:'M24 25V46M24 32L12 46M24 32L36 46M24 46L16 70M24 46L32 70',sit:'M24 25V43L38 44L38 68M24 43L19 47L19 68M24 32L12 45M24 32L35 44',kneel:'M24 25V43L17 57L34 62M24 43L31 57L14 62M24 32L12 44M24 32L36 44',prone:'M13 46L34 46L43 52M20 46L15 57M28 46L24 57',lie:'M12 48L32 48L40 55M20 48L13 58M25 48L33 58'}[pose] || '';
 return `<svg viewBox="0 0 48 78" aria-hidden="true"><ellipse cx="24" cy="74" rx="17" ry="3" fill="#000" opacity=".3"/><path d="${body}" fill="none" stroke="#eee9df" stroke-width="9" stroke-linecap="round" stroke-linejoin="round"/><circle cx="${pose==='prone'?7:pose==='lie'?40:24}" cy="${pose==='prone'||pose==='lie'?42:14}" r="8" fill="#eee9df"/></svg>`;
}
