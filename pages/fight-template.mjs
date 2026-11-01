// 打戏提示词只拼文字，不调用模型，也不读取外部技能包。
export const BUILTIN_FIGHT_ID = 'builtin:fight';
export const SKILL_CHAR_LIMIT = 1500;
export const SEGMENT_MIN = 8;
export const SEGMENT_MAX = 15;
export const MOTION_TRANSFER_MAX = 9;

export const PROHIBITION_ITEMS = [
  '多出手脚',
  '肢体糊成一团',
  '武器被换掉或消失',
  '左右手互换',
  '脸和服装变了',
  '镜头乱晃',
  '把歌词当画面内容',
  '整段同一个速度、没有停顿',
];
export const PROHIBITIONS = `禁止：${PROHIBITION_ITEMS.join('，')}。`;

export const FIGHT_TEMPLATE = {
  id: 'fight',
  name: '打戏 / 动作',
  tag: '起势 · 接触 · 收势',
  description: '按 8–15 秒分段，锁定人物和武器，每段一个主运镜。',
};

// 物理机位：写地点、高度、朝向和身体部位，不写角度数字。
export const CAMERA_POSITIONS = [
  {id:'ground-up', label:'贴地仰拍', where:'地面', height:'贴地', facing:'仰拍', aim:'下巴到胸口'},
  {id:'knee', label:'膝高侧面', where:'人物脚边', height:'膝盖高', facing:'侧面', aim:'腰'},
  {id:'waist-profile', label:'齐腰正侧面', where:'东墙边', height:'齐腰高', facing:'正侧面', aim:'胸口'},
  {id:'chest-front', label:'齐胸正面', where:'两人正前方', height:'齐胸高', facing:'正面', aim:'胸口'},
  {id:'eye-front', label:'眼平正面', where:'正前方', height:'眼睛高度', facing:'平视', aim:'眼睛'},
  {id:'eye-side', label:'眼平侧面', where:'侧面', height:'眼睛高度', facing:'正侧面', aim:'眼睛'},
  {id:'shoulder', label:'过肩', where:'一人肩后', height:'眼睛高度', facing:'过肩', aim:'另一人的脸'},
  {id:'back', label:'肩高背后', where:'背后', height:'肩膀高', facing:'背面', aim:'后背'},
  {id:'hip-side', label:'低位侧面', where:'侧面近处', height:'髋部高', facing:'侧面', aim:'髋到肩'},
  {id:'high-down', label:'高位俯看', where:'上方', height:'高出头顶', facing:'俯看', aim:'头顶和肩'},
  {id:'wall', label:'贴墙中景', where:'墙边', height:'齐胸高', facing:'斜侧面', aim:'上半身'},
  {id:'door', label:'门口看进来', where:'门口', height:'眼睛高度', facing:'看进室内', aim:'全身'},
  {id:'table', label:'桌面高度', where:'桌旁', height:'桌面高', facing:'平视', aim:'手和武器'},
  {id:'weapon', label:'武器近处', where:'武器旁', height:'武器高度', facing:'靠近', aim:'武器'},
  {id:'feet', label:'脚部低位', where:'地面附近', height:'脚踝高', facing:'低位', aim:'脚和步子'},
  {id:'wide', label:'远景全场', where:'房间另一头', height:'眼睛高度', facing:'看全场', aim:'两个人的全身'},
  {id:'face', label:'近景对脸', where:'脸的侧前方', height:'眼睛高度', facing:'靠近', aim:'脸'},
  {id:'axis', label:'双人对看', where:'两人侧面连线上', height:'眼睛高度', facing:'正侧面', aim:'两人的眼睛'},
  {id:'charge', label:'冲刺前方', where:'人物冲去的方向前方', height:'齐腰高', facing:'迎面', aim:'胸口'},
  {id:'retreat', label:'退后的后方', where:'被击退一方的身后', height:'齐胸高', facing:'背面', aim:'后背'},
  {id:'stair-up', label:'台阶下向上', where:'台阶下方', height:'低于人物', facing:'向上看', aim:'全身'},
  {id:'stair-down', label:'台阶上向下', where:'台阶上方', height:'高于人物', facing:'向下看', aim:'头顶到脚'},
  {id:'window', label:'窗边侧光', where:'窗边', height:'眼睛高度', facing:'侧面', aim:'身体的受光一侧'},
  {id:'pillar', label:'柱子后面', where:'柱边', height:'眼睛高度', facing:'从遮挡后看出', aim:'露出来的半身'},
  {id:'settle', label:'收势停位', where:'段尾姿势的侧前方', height:'齐腰高', facing:'正侧面', aim:'收势时的刀和手'},
];

// 每段只选一个主运镜。人物没换高度、位置或转向时，镜头不动。
export const CAMERA_MOVES = [
  {id:'hold', label:'镜头不动，只负责看'},
  {id:'lateral', label:'横向跟着移动，只有人物冲上去的时候才跟'},
  {id:'follow-in', label:'向前跟进一步，只有人物前进时才动'},
  {id:'pull-back', label:'向后拉开，只有两人分开时才动'},
  {id:'rise', label:'升起，只有人物高度变了才动'},
  {id:'drop', label:'降下，只有人物重心压低时才动'},
  {id:'ground', label:'贴地跟着，只有脚步移动时才动'},
  {id:'shoulder', label:'过肩跟着，只在转身时改看的人'},
  {id:'arc', label:'绕到另一侧，只在人物换边时动'},
  {id:'push-hit', label:'推近到接触，打中时停住'},
  {id:'widen', label:'拉开看到全身，只在两人分开时动'},
  {id:'pan-next', label:'摇到下一个人，只在出手对象换了才动'},
  {id:'settle', label:'停在段尾姿势上'},
];

const round1 = n => Math.round(Number(n) * 10) / 10;
const formatSec = n => {
  const v = round1(n);
  return Number.isInteger(v) ? String(v) : v.toFixed(1);
};
const clean = (value, max = 500) => String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);

export function planSegments(durationSec, {motionTransfer = false} = {}) {
  const duration = round1(Math.max(0.1, Math.min(60, Number(durationSec) || 5)));
  const max = motionTransfer ? MOTION_TRANSFER_MAX : SEGMENT_MAX;
  const ticks = Math.round(duration * 10);
  if (duration <= max) return [{index: 1, local: duration, short: duration < SEGMENT_MIN}];
  const count = Math.ceil(ticks / Math.round(max * 10));
  const each = Math.floor(ticks / count);
  let extra = ticks - each * count;
  const parts = [];
  for (let i = 0; i < count; i++) {
    const part = each + (extra > 0 ? 1 : 0);
    if (extra > 0) extra--;
    parts.push({index: i + 1, local: part / 10, short: part / 10 < SEGMENT_MIN});
  }
  return parts;
}

function parseImpacts(value, local) {
  const nums = String(value ?? '').split(/[^0-9.]+/).filter(Boolean).map(Number).filter(n => Number.isFinite(n) && n >= 0 && n <= local + 0.001);
  return [...new Set(nums.map(round1))].slice(0, 2);
}
function defaultImpacts(local) {
  const first = round1(Math.min(Math.max(local - 0.3, 0.1), Math.max(0.4, local * 0.35)));
  if (local >= 12) return [first, round1(Math.min(local - 0.3, local * 0.7))];
  return [first];
}
function cameraLine(input) {
  const preset = CAMERA_POSITIONS.find(item => item.id === input.cameraId) || CAMERA_POSITIONS[2];
  const move = CAMERA_MOVES.find(item => item.id === input.moveId);
  const where = clean(input.cameraWhere) || preset.where;
  const height = clean(input.cameraHeight) || preset.height;
  const facing = clean(input.cameraFacing) || preset.facing;
  const aim = clean(input.cameraAim) || preset.aim;
  const moveLabel = clean(input.moveLabel, 120) || move?.label || CAMERA_MOVES[0].label;
  return `机位在${where}，${height}，${facing}拍，对着${aim}。主运镜：${moveLabel}。只有人物换了高度、位置或转向时镜头才动，平时镜头只负责看。`;
}
function defaultTimeline(local, impacts, rounds) {
  const [first, second] = impacts;
  const mid = second || Math.min(local, round1(first + (local - first) * 0.55));
  const lines = [];
  if (local < SEGMENT_MIN) lines.push('这一段不到 8 秒，只写这段时长里做得完的动作，不硬塞高难度招式。');
  lines.push(`0–${formatSec(first)} 秒：起势，重心压低、武器还在原来的手里，再出招。`);
  lines.push(`${formatSec(first)} 秒冲击帧：武器接触对方，画面停一下，镜头不动。`);
  lines.push(`${formatSec(first)}–${formatSec(mid)} 秒：反应，被击中的一方退开或格挡，出手的一方从接触回到可继续的姿势。`);
  if (second) lines.push(`${formatSec(second)} 秒冲击帧：第二次接触，画面停一下，镜头不动。`);
  lines.push(`${formatSec(Math.max(mid, second || mid))}–${formatSec(local)} 秒：收势。上一招的收势就是下一招的起势，中间不回到原地站好。`);
  if (rounds > 2) lines.push(`这一段安排 ${rounds} 个来回，重击点仍然只有 ${impacts.length} 个。`);
  return lines.join('');
}

export function buildFightPrompt(input = {}) {
  const duration = round1(Math.max(0.1, Math.min(60, Number(input.duration) || 5)));
  const motionTransfer = input.motionTransfer === true || input.motionTransfer === 'transfer';
  const segments = planSegments(duration, {motionTransfer});
  const rounds = Math.max(1, Math.min(6, Math.round(Number(input.rounds) || 1)));
  const characters = clean(input.characters, 300) || '人物沿用参考图';
  const weapons = clean(input.weapons, 400) || '哪只手拿什么、出鞘还是入鞘，都沿用参考图，本段不换手、不换武器。';
  const scene = clean(input.scene, 200) || '场景沿用本镜画面';
  const endPose = clean(input.endPose, 200) || '保持收势';
  const refs = Array.isArray(input.references) ? input.references.filter(item => item && (item.note || item.name)).slice(0, 8) : [];
  const reference = refs.length
    ? refs.map((item, index) => {
      const subject = clean(item.note || item.name, 120).replace(/的脸、服装、武器的唯一依据。?$/, '').replace(/的脸、服装、武器$/, '');
      return `参考图 ${index + 1} 是${subject}的脸、服装、武器的唯一依据。`;
    }).join('')
    : '人物参考图是脸、服装、武器外观的唯一依据。';
  const lock = `${characters}。${weapons}`;
  const action = clean(input.action, 1200);
  const blocks = segments.map((segment, index) => {
    const impacts = parseImpacts(input.impacts, segment.local);
    const points = impacts.length ? impacts : defaultImpacts(segment.local);
    const timeline = action && segments.length === 1 ? action : defaultTimeline(segment.local, points, rounds);
    const handoff = index === segments.length - 1 ? `段尾${endPose}，下一镜从这个姿势接。` : `段尾${endPose}，下一段从这个姿势接。`;
    return `第 ${segment.index} 段（${formatSec(segment.local)} 秒，可单独生成，段内从 0 秒计）${segment.short ? '。这段偏短，不硬塞高难度招式' : ''}。本段锁定：${lock}。${timeline}${handoff}`;
  });
  const lastHandoff = `段尾${endPose}，下一镜从这个姿势接。`;
  const prompt = [
    `【参考权限】\n${reference}`,
    `【人物与武器锁定】\n${lock}`,
    `【场景与机位】\n场景是${scene}。${cameraLine(input)}`,
    `【分段时间轴】\n${blocks.join('\n')}`,
    `【段尾交接】\n${lastHandoff}`,
    `【禁止项】\n${PROHIBITIONS}`,
  ].join('\n');
  return {id: BUILTIN_FIGHT_ID, name: FIGHT_TEMPLATE.name, duration, ratio: input.ratio || '16:9', segments, prohibitions: PROHIBITIONS, prompt};
}
