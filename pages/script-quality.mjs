/**
 * Non-destructive local screenplay quality gate for the actual Jubaopeng Canvas.
 * This module never edits the source text or claims to be an AI review.
 */
const ACTION_HEAD=/^[△▲]/;
const SCENE_HEAD=/^\d+\s*-\s*\d+\s+\S+/;
const DIALOGUE_HEAD=/^([\u3400-\u9fffA-Za-z0-9]{1,10})（([^）]+)）[：:]/;
const PHYSICAL=/(低头|抬头|抿嘴|摇头|点头|抬眼|垂眼|转身|起身|走近|上前|后退|拍桌|指向|伸手|抬手|抓住|端起|拿起|递给|看向|看着|望向|盯着|推门|开门|关门|扶住|坐下|站起|蹲下|弯腰)/;

export function auditScript(script){
  const lines=String(script??'').replace(/\r\n?/g,'\n').split('\n');
  const issues=[];
  let prevAction=false, reportedRun=false;
  const push=(severity,category,line,excerpt,hint)=>issues.push({severity,category,line,excerpt:String(excerpt).slice(0,180),hint});
  for(let i=0;i<lines.length;i++){
    const line=lines[i].trim();
    if(!line)continue; // blank line does not separate consecutive action paragraphs
    const action=ACTION_HEAD.test(line);
    if(action&&prevAction&&!reportedRun){
      push('red','同场动作机械拆段',i+1,line,'无对白、无转场的连续△动作应合并为一个动作段，按实际动作顺序书写。');
      reportedRun=true;
    }
    if(!action)reportedRun=false;
    prevAction=action;
    const dialogue=line.match(DIALOGUE_HEAD);
    if(dialogue&&PHYSICAL.test(dialogue[2])){
      push('red','人物名后误写动作',i+1,line,'角色名后的括号只能写情绪或声调；低头、抿嘴、走位、道具操作改入△动作行。');
    }
    if(action&&/[他她它]/.test(line)){
      push('amber','动作中的代词',i+1,line,'确认是否可换为具体人物名或物名，避免多人同场指代混乱。');
    }
    if(/^字幕[：:]/.test(line)&&line.includes('△')){
      push('amber','字幕与动作混写',i+1,line,'字幕单独成行，动作另起△段。');
    }
    if(SCENE_HEAD.test(line)&&i>0&&SCENE_HEAD.test(lines[i-1].trim())){
      push('amber','连续空场头',i+1,line,'检查是否不必要地拆分同一地点；场头应对应真实转场。');
    }
  }
  const red=issues.filter(issue=>issue.severity==='red').length;
  const amber=issues.filter(issue=>issue.severity==='amber').length;
  return {issues,red,amber,lineCount:lines.length};
}

/** 95-point gate is only applicable after an independent model reviewer returns a score. */
export function meetsAcceptance(review,localReport,threshold=95){
  return Boolean(
    review && typeof review.score==='number' &&
    Number.isFinite(review.score) && review.score>=threshold && review.score<=100 &&
    Array.isArray(review.hardFailures) && review.hardFailures.length===0 &&
    localReport && localReport.red===0
  );
}
