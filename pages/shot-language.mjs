/** 景别：画框里装多少，不是机位高低。模型使用 close-up / wide establishing。 */
export const SHOT_SIZES = [
  { id: "极端特写", label: "极端特写", prompt: "extreme close-up shot" },
  { id: "特写", label: "特写", prompt: "close-up shot" },
  { id: "近景", label: "近景", prompt: "medium close-up shot, head and shoulders" },
  { id: "中景", label: "中景", prompt: "medium shot" },
  { id: "全景", label: "全景", prompt: "full shot, whole subject in frame" },
  { id: "远景", label: "远景", prompt: "wide shot" },
  { id: "大远景", label: "大远景", prompt: "extreme wide establishing shot" },
];

/** 机位 / 从哪看：镜头站在哪、朝哪。 */
export const ANGLES = [
  { id: "眼睛平视", label: "眼睛平视", prompt: "eye-level camera" },
  { id: "正面镜头", label: "正面镜头", prompt: "front-on camera" },
  { id: "俯拍", label: "俯拍", prompt: "high angle looking down" },
  { id: "仰拍", label: "仰拍", prompt: "low angle looking up" },
  { id: "鸟瞰镜头", label: "鸟瞰镜头", prompt: "aerial drone bird's-eye view" },
  { id: "地面视角", label: "地面视角", prompt: "ground-level camera" },
  { id: "广角镜头", label: "广角镜头", prompt: "wide-angle lens" },
  { id: "超广角", label: "超广角", prompt: "ultra wide-angle lens" },
  { id: "鱼眼镜头", label: "鱼眼镜头", prompt: "fisheye lens" },
  { id: "荷兰角", label: "荷兰角", prompt: "dutch angle, tilted horizon" },
  { id: "微距视角", label: "微距视角", prompt: "macro viewpoint" },
  { id: "倒影镜头", label: "倒影镜头", prompt: "shot in a reflection" },
  { id: "窥视镜头", label: "窥视镜头", prompt: "voyeur shot through a gap or doorway" },
  { id: "过肩镜头", label: "过肩镜头", prompt: "over-the-shoulder two-person shot, camera behind one character's shoulder looking at another character's face" },
  { id: "第一视角", label: "第一视角", prompt: "first-person POV" },
  { id: "自拍视角", label: "自拍视角", prompt: "selfie phone POV" },
];

/** 构图：人/物在画框里怎么摆。 */
export const COMPOSITIONS = [
  { id: "对称构图", label: "对称构图", prompt: "symmetrical composition" },
  { id: "三分构图", label: "三分构图", prompt: "rule of thirds" },
  { id: "框架构图", label: "框架构图", prompt: "frame within a frame" },
  { id: "窥视构图", label: "窥视构图", prompt: "peeping framed composition" },
  { id: "双人镜头", label: "双人镜头", prompt: "two-shot" },
  { id: "牛仔景", label: "牛仔景", prompt: "cowboy shot, mid-thigh up" },
  { id: "等轴视角", label: "等轴视角", prompt: "isometric view" },
];

/**
 * 运镜：镜头怎么动。使用明确的运镜词：
 * pan / tilt / zoom / dolly / tracking / orbit / aerial / handheld / static / push-in
 */
export const CAMERA_MOVES = [
  { id: "固定镜头", label: "固定镜头", prompt: "static tripod, locked-off camera, no movement" },
  { id: "缓慢推进", label: "缓慢推进", prompt: "slow dolly in, gentle camera push-in" },
  { id: "缓慢拉开", label: "缓慢拉开", prompt: "slow dolly out, camera pull back" },
  { id: "快速拉近", label: "快速拉近", prompt: "fast dolly in" },
  { id: "快速拉出", label: "快速拉出", prompt: "fast dolly out" },
  { id: "左平移", label: "左平移", prompt: "pan left" },
  { id: "右平摇", label: "右平摇", prompt: "pan right" },
  { id: "上摇镜头", label: "上摇镜头", prompt: "tilt up" },
  { id: "下摇镜头", label: "下摇镜头", prompt: "tilt down" },
  { id: "360度环绕拍摄", label: "360度环绕", prompt: "camera orbiting 360 degrees, surround" },
  { id: "斯坦尼康跟拍", label: "斯坦尼康跟拍", prompt: "Steadicam tracking shot, smooth continuous subject following, stable horizon, constant focal length, no handheld shake" },
  { id: "跟随拍摄", label: "跟随拍摄", prompt: "tracking follow shot" },
  { id: "旋转镜头", label: "旋转镜头", prompt: "camera orbit around subject" },
  { id: "变焦放大", label: "变焦放大", prompt: "zoom in" },
  { id: "变焦缩小", label: "变焦缩小", prompt: "zoom out" },
  { id: "手持镜头", label: "手持镜头", prompt: "handheld camera" },
  { id: "动态变焦", label: "动态变焦", prompt: "dolly zoom" },
  { id: "液体运镜", label: "液体运镜", prompt: "fluid steadicam move" },
  { id: "疾速追踪", label: "疾速追踪", prompt: "high-speed tracking shot" },
  { id: "甩镜头", label: "甩镜头", prompt: "whip pan" },
  { id: "旋转上升", label: "旋转上升", prompt: "crane up while orbiting" },
  { id: "旋转下降", label: "旋转下降", prompt: "crane down while orbiting" },
  { id: "抛物线运镜", label: "抛物线运镜", prompt: "parabolic crane move" },
  { id: "穿越镜头", label: "穿越镜头", prompt: "camera travels through a doorway or object" },
  { id: "失重漂浮", label: "失重漂浮", prompt: "weightless floating camera" },
  { id: "光影切割", label: "光影切割", prompt: "camera moves through cuts of light and shadow" },
  { id: "碰撞切换", label: "碰撞切换", prompt: "crash-cut energy, abrupt camera stop" },
  { id: "慢动作", label: "慢动作", prompt: "slow motion implied still" },
  { id: "加速播放", label: "加速播放", prompt: "sped-up motion implied still" },
  { id: "升格镜头", label: "升格镜头", prompt: "high-speed overcranked still" },
  { id: "降格镜头", label: "降格镜头", prompt: "undercranked still" },
  { id: "静态延迟", label: "静态延迟", prompt: "held static beat" },
];

export const STYLIZES = [
  { id: "电影叙事", label: "电影叙事", prompt: "narrative cinema still" },
  { id: "运动相机", label: "运动相机", prompt: "action-cam / GoPro look" },
  { id: "监控录像", label: "监控录像", prompt: "surveillance camera still" },
  { id: "柯达Portra 400", label: "柯达 Portra 400", prompt: "Kodak Portra 400 film" },
  { id: "富士Velvia", label: "富士 Velvia", prompt: "Fujifilm Velvia color" },
  { id: "录像带画质", label: "录像带画质", prompt: "VHS grain" },
  { id: "8毫米胶片", label: "8毫米胶片", prompt: "8mm film" },
  { id: "35毫米胶片", label: "35毫米胶片", prompt: "35mm motion-picture film, anamorphic lens" },
  { id: "IMAX画质", label: "IMAX 画质", prompt: "IMAX large-format still" },
  { id: "夜景光辉", label: "夜景光辉", prompt: "luminous night photography" },
  { id: "雨景镜头", label: "雨景镜头", prompt: "rain-soaked cinematography" },
  { id: "忧郁慢推", label: "忧郁慢推", prompt: "melancholy slow push-in mood" },
  { id: "紧张晃动", label: "紧张晃动", prompt: "tense handheld energy" },
  { id: "浪漫旋转", label: "浪漫旋转", prompt: "romantic orbit" },
  { id: "恐惧倾斜", label: "恐惧倾斜", prompt: "horror dutch-tilt dread" },
  { id: "欢快跳跃", label: "欢快跳跃", prompt: "playful bounce energy" },
  { id: "孤独长镜头", label: "孤独长镜头", prompt: "lonely long-take stillness" },
  { id: "悬疑跟拍", label: "悬疑跟拍", prompt: "suspense tracking shot" },
  { id: "梦幻移焦", label: "梦幻移焦", prompt: "dreamy rack focus" },
  { id: "史诗拉升", label: "史诗拉升", prompt: "epic crane rise" },
  { id: "焦虑碎片", label: "焦虑碎片", prompt: "anxious fragmented still" },
  { id: "治愈固定", label: "治愈固定", prompt: "gentle locked-off comfort" },
  { id: "宿命感旋转", label: "宿命感旋转", prompt: "fatalistic circling camera" },
  { id: "记忆闪回", label: "记忆闪回", prompt: "memory flashback look" },
];

export const LIGHTINGS = [
  { id: "电影级布光", label: "电影级布光", prompt: "cinematic lighting, dramatic lighting" },
  { id: "蓝调时刻", label: "蓝调时刻", prompt: "blue hour" },
  { id: "明暗对照法", label: "明暗对照法", prompt: "chiaroscuro" },
  { id: "柔光箱光效", label: "柔光箱光效", prompt: "softbox lighting, soft studio lighting" },
  { id: "生物荧光", label: "生物荧光", prompt: "bioluminescence" },
  { id: "镜头光晕", label: "镜头光晕", prompt: "lens flare" },
  { id: "自然光", label: "自然光", prompt: "photoreal natural light" },
  { id: "丁达尔光", label: "丁达尔光", prompt: "volumetric lighting, god rays" },
  { id: "轮廓光", label: "轮廓光", prompt: "rim light" },
  { id: "硬光", label: "硬光", prompt: "hard light, dynamic shadows" },
  { id: "情绪化布光", label: "情绪化布光", prompt: "moody lighting" },
  { id: "全局光照", label: "全局光照", prompt: "global illumination" },
  { id: "黄金时刻", label: "黄金时刻", prompt: "golden hour light" },
  { id: "伦勃朗光", label: "伦勃朗光", prompt: "Rembrandt lighting" },
  { id: "逆光", label: "逆光", prompt: "backlight" },
  { id: "霓虹光", label: "霓虹光", prompt: "neon light" },
  { id: "影棚布光", label: "影棚布光", prompt: "clean studio lighting" },
  { id: "光线追踪", label: "光线追踪", prompt: "ray-traced light" },
];

export const TECHNIQUES = [
  { id: "长曝光", label: "长曝光", prompt: "long exposure" },
  { id: "双重曝光", label: "双重曝光", prompt: "double exposure" },
  { id: "定格动画风格", label: "定格动画", prompt: "stop-motion look" },
  { id: "暗角", label: "暗角", prompt: "vignetting" },
  { id: "胶片颗粒", label: "胶片颗粒", prompt: "film grain" },
  { id: "光绘", label: "光绘", prompt: "light painting" },
  { id: "色差", label: "色差", prompt: "chromatic aberration" },
  { id: "延时摄影", label: "延时摄影", prompt: "time-lapse implied still" },
  { id: "高动态范围", label: "HDR", prompt: "HDR high dynamic range" },
];


