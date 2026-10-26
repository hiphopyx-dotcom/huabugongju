import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {project} from '../public/studio/core.mjs';
function render({separate=false,role='admin'}={}){
 const main={innerHTML:'',insertAdjacentHTML(_,html){this.innerHTML+=html},querySelectorAll:()=>[]};
 const document={addEventListener(){},querySelector:s=>s==='#main'?main:{}};
 const context=vm.createContext({document,location:{pathname:'/'},URL,console,setTimeout(){}});
 const source=fs.readFileSync(new URL('../public/studio/accounts.mjs',import.meta.url),'utf8').replace(/^import .*\n/gm,'').replace(/\bexport /g,'');
 vm.runInContext(source+`\nuser={role:${JSON.stringify(role)}};models.find(m=>m.id==='image').url='https://studio.example/';models.find(m=>m.id==='storyboard').url='https://studio.example/';${separate?"models.find(m=>m.id==='storyboard').url='https://separate.example/';":''}globalThis.renderModules=renderModules;`,context);
 context.renderModules(project('测试项目'));return main.innerHTML;
}
test('相同图片和分镜工坊只显示一张模型卡，并补充视频独立入口',()=>{const html=render(),titles=[...html.matchAll(/<h3>(.*?)<\/h3>/g)].map(m=>m[1]);assert.ok(titles.includes('视频生成'));assert.ok(titles.includes('图片与分镜生成'));assert.equal((html.match(/data-module="(?:image|storyboard)"/g)||[]).length,1);assert.match(html,/data-page="video"/);assert.match(html,/tool=video/);});
test('配置了不同分镜工坊时保留独立入口，模型中心仍只向管理员开放',()=>{const html=render({separate:true});assert.match(html,/data-module="storyboard"/);assert.match(html,/data-module="image"/);assert.match(html,/视频生成/);assert.ok(!render({role:'user'}).includes('data-module='));});
