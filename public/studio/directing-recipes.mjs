/** 导演配方：把片场规矩写成可套用的视频提示词骨架。原创文案，不安装第三方 Agent 技能包。 */
export const recipes = [
  {
    id: 'shot',
    name: '镜头架设',
    tag: '景别 · 机位 · 终点',
    description: '先定画框装多少、从哪看、落到哪一帧，再写动作。',
    focus: '用景别和机位说明观众该看什么；结尾画面必须可读。',
    rules: [
      '只选一个主景别：大远景写环境，中景写互动，特写写表情或手部，不要混景。',
      '写清机位：平视 / 俯 / 仰 / 过肩，以及镜头站在场景哪一侧。',
      '起幅写清构图，落幅写清变化后的终点；没有终点就不要动镜头。',
      '脸、手、Logo、服装这些易漂锚点要点名保留。',
    ],
  },
  {
    id: 'camera',
    name: '运镜路径',
    tag: '推拉 · 跟移 · 固定',
    description: '一段只走一条运镜；速度和终点一起写死。',
    focus: '运镜服务意图：推进逼近、拉开揭示、横移带过、固定让表演落地。',
    rules: [
      '主运镜只能有一个：固定 / 缓慢推进 / 缓慢拉开 / 横移 / 跟拍 / 环绕。',
      '写速度与幅度：慢、稳、短距；禁止空泛的“电影感运镜”。',
      '人物动作与镜头运动分开写，不要用同一个“慢”同时形容表演和机位。',
      '续拍需要开口运动时，落幅保持方向感；独立成片则落幅收稳。',
    ],
  },
  {
    id: 'rhythm',
    name: '节奏踩点',
    tag: '节拍 · 停顿 · 收束',
    description: '按事件节拍切，不按秒数堆形容词。',
    focus: '每个节拍一个可见变化；冲击点后给停顿，结尾给收束。',
    rules: [
      '按镜头顺序写，不写精确到秒的时间码；模型对精确秒数不稳定。',
      '开场两镜内让观众看懂情境，中间一个转折，结尾停在失败者或结果上。',
      '冲击帧后镜头可短暂停住，让接触、表情或道具结果读清楚。',
      '整段不要同一速度；允许一处明显的加速或减速，并写明原因。',
    ],
  },
  {
    id: 'cut',
    name: '分镜切法',
    tag: '主镜 · 反打 · 插入',
    description: '多镜按事件先后编号；每镜只做一件事。',
    focus: '切镜是买连续性的代价：光、身份、站位要在每镜重申。',
    rules: [
      '镜头1、镜头2…按事件先后；一镜一个主动作，其余人继续闲动作，不要全体定格。',
      '每镜结尾写锁定行：同一光源与色温、主角年龄段/发型/服装、相对地标的站位与朝向。',
      '反打要交代摄影机换到反应对象一侧，视线越过镜头朝向对方。',
      '需要插入特写时单独成镜，不把主动作和插入塞进同一句。',
    ],
  },
  {
    id: 'scene',
    name: '场景铺陈',
    tag: '空间 · 光 · 空气',
    description: '先铺可读的空间与光，再让人走进去做一件事。',
    focus: '材质、光源、空气里的东西都要具体，不用“氛围感”。',
    rules: [
      '先写空间锚点：门、窗、柜台、街道方向，再写人物从哪边进入。',
      '光写来源与软硬冷暖：侧窗灰日光、顶灯钨丝暖光，不要只写“氛围好”。',
      '空气里写可见物：蒸汽、雨丝、尘、烟；没有就明确干净空气。',
      '环境声单独一句；不要把字幕、广告文案交给模型生成。',
    ],
  },
  {
    id: 'action',
    name: '动作调度',
    tag: '表演 · 接触 · 道具',
    description: '情绪用白话，再给一个身体锚点；道具经手完成。',
    focus: '直写镜头能拍到的动作，成语和比喻一律改成可见行为。',
    rules: [
      '情绪 + 一个身体锚点：愣住、惊慌、眼睛盯着门口，喉结动一下。',
      '一镜一个主动作；放下杯子、转身、旁人起身若都重要，拆成多镜。',
      '道具动作写经哪只手、碰到哪、结果是什么；禁止道具凭空换掉或消失。',
      '禁止项：肢体糊成一团、左右手互换、多人同时抢主动作、把歌词当画面。',
    ],
  },
  {
    id: 'style',
    name: '风格锁定',
    tag: '调色 · 质感 · 禁词',
    description: '用材料、胶片、光比定风格，不用空的高级感词汇。',
    focus: '风格是可重复的约束，不是堆叠形容词。',
    rules: [
      '写材质与成像：皮肤质感、布料纹理、35mm 胶片颗粒、干净数字、监控感。',
      '写色彩约束：主色、辅色、是否偏冷/偏暖；Logo 与皮肤色不要漂。',
      '禁用空词：电影感、高级感、氛围感、史诗、大师级——改成景别、光、材质。',
      '参考图只承担一种角色：锁脸、锁服装、或锁场景；不要一张图同时控一切。',
    ],
  },
];

const fields = {
  intention: 'directingIntention',
  subject: 'directingSubject',
  action: 'directingAction',
  notes: 'directingNotes',
};

function trimSetting(settings, key) {
  return String(settings?.[key] || '').trim().slice(0, 4000);
}

export function build(p) {
  const settings = p.settings || {};
  const recipe = recipes.find((item) => item.id === settings.directingRecipeId) || recipes[0];
  const intention = trimSetting(settings, fields.intention);
  const subject = trimSetting(settings, fields.subject);
  const action = trimSetting(settings, fields.action);
  const notes = trimSetting(settings, fields.notes);
  const duration = Math.round(Math.max(1, Math.min(60, Number(settings.videoDuration) || 5)) * 10) / 10;
  const ratio = ['16:9', '9:16', '1:1'].includes(settings.videoRatio)
    ? settings.videoRatio
    : settings.ratio || '16:9';
  const ids = Array.isArray(settings.videoRefs) ? settings.videoRefs : [];
  const refs = ids.map((id) => p.assets?.find((a) => a.id === id && a.kind === 'image')).filter(Boolean);

  const prompt = [
    `【导演配方 · ${recipe.name}】`,
    `为 ${duration} 秒 ${ratio} 视频写导演级提示词。准则：导演模型，不抠每一帧；按镜头写可见事实。`,
    `本镜焦点：${recipe.focus}`,
    `场景意图：${intention || '【填写这场戏要完成的转折、揭示、情绪或展示】'}`,
    `主体：${subject || '【填写人物或主体的年龄段、发型、服装、区分物】'}`,
    `关键动作：${action || '【填写一个主动作及其可见结果】'}`,
    notes ? `补充约束：${notes}` : '',
    `配方规则：\n${recipe.rules.map((rule, i) => `${i + 1}. ${rule}`).join('\n')}`,
    settings.videoSequence
      ? '已有逐镜编排时：时码、参考图和镜头语言优先；本配方只补导演约束。'
      : '输出时按镜头1、镜头2…组织；每镜一个主动作，结尾写锁定行（光、身份、站位）。',
    refs.length
      ? `参考图角色：\n${refs.map((a, i) => `${i + 1}. ${a.name}${a.description ? '：' + String(a.description).slice(0, 400) : ''} —— 只承担一种锁定职责`).join('\n')}`
      : '无参考图时，在正文里重复主体外观与场景锚点，保证切镜后不漂。',
    '禁止：空泛形容词堆砌、一镜多主动作、全体定格、道具失踪、字幕文案交给模型。',
  ].filter(Boolean).join('\n\n');

  return {
    id: recipe.id,
    name: recipe.name,
    version: 1,
    inputs: {intention, subject, action, notes},
    duration,
    ratio,
    referenceIds: refs.map((a) => a.id),
    focus: recipe.focus,
    rules: recipe.rules,
    prompt,
  };
}
