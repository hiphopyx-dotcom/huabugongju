import test from 'node:test';
import assert from 'node:assert/strict';
import {buildHandoff} from '../public/studio/chatgpt-handoff.mjs';
test('统一作品设定带入写作，新作品明确从第1集开始',()=>{
 const project={title:'测试作品',script:'',settings:{genre:'悬疑'},story:{premise:'确认的故事梗概',outline:'确认的大纲',characters:'人物动机与口吻',episodePlan:'分集计划',targetEpisodes:40}};
 const result=buildHandoff(project,{kind:'next'});
 for(const text of ['确认的故事梗概','确认的大纲','人物动机与口吻','分集计划','作品目标集数：40','正文必须以“第1集”开头'])assert.ok(result.prompt.includes(text),text);
});
