import * as THREE from 'three';
import {SVGRenderer} from 'three/examples/jsm/renderers/SVGRenderer.js';

// Project the original Three.js scene into SVG when WebGL is unavailable.
// Both views use the same scene, camera poses, geometry and animation clock.
export function createRenderer(options){
 const canvas=document.createElement('canvas');let context=null;
 try{context=canvas.getContext('webgl2',{alpha:false,antialias:false})}catch{}
 if(context){const renderer=new THREE.WebGLRenderer({...options,canvas,context});renderer.domElement.dataset.renderer='webgl';return renderer;}
 return new SoftwareRenderer();
}
class SoftwareRenderer{
 constructor(){this.domElement=document.createElement('div');this.domElement.dataset.renderer='software-3d';this.domElement.style.position='relative';this.domElement.style.overflow='hidden';this.views=[new SVGRenderer(),new SVGRenderer()];this.materials=new WeakMap();this.view={x:0,y:0,w:2,h:2};this.width=2;this.height=2;this.target=null;this.raf=0;this.last=0;this.clearColor='#000';for(const r of this.views){r.setQuality('low');r.domElement.style.position='absolute';r.domElement.style.pointerEvents='none';this.domElement.appendChild(r.domElement);}}
 setPixelRatio(){} setScissorTest(){} setScissor(){} forceContextLoss(){}
 setSize(w,h){this.width=w;this.height=h;}
 setViewport(x,y,w,h){this.view={x,y,w,h};}
 setRenderTarget(target){this.target=target;}
 setClearColor(color){this.clearColor=new THREE.Color(color).getStyle();}
 place(renderer){const {x,y,w,h}=this.view;renderer.setSize(w,h);Object.assign(renderer.domElement.style,{left:x+'px',top:(this.height-y-h)+'px',width:w+'px',height:h+'px',display:'block'});}
 clear(){const renderer=this.views[1];this.place(renderer);renderer.clear();renderer.domElement.style.background=this.clearColor;}
 render(scene,camera){
  const postprocess=scene.children.some(o=>o.material?.isShaderMaterial);
  const small=this.target||postprocess||this.view.x>0||this.view.w<this.width;
  const renderer=this.views[small?1:0];this.place(renderer);
  if(postprocess){renderer.domElement.style.clipPath='circle(48% at 50% 50%)';return;}
  renderer.domElement.style.clipPath=this.target?'circle(48% at 50% 50%)':'';
  scene.traverse(obj=>{if(!obj.isMesh)return;const convert=material=>{if(!material?.isMeshStandardMaterial)return material;if(!this.materials.has(material))this.materials.set(material,new THREE.MeshLambertMaterial({color:material.color,opacity:material.opacity,transparent:material.transparent,side:material.side,depthWrite:material.depthWrite}));return this.materials.get(material)};obj.material=Array.isArray(obj.material)?obj.material.map(convert):convert(obj.material);});
  if(!scene.userData.svgAmbient){scene.userData.svgAmbient=true;scene.add(new THREE.AmbientLight(0xf2ebe3,.65));}
  renderer.render(scene,camera);
 }
 setAnimationLoop(callback){cancelAnimationFrame(this.raf);this.callback=callback;if(!callback)return;const tick=time=>{if(this.callback!==callback)return;this.raf=requestAnimationFrame(tick);if(time-this.last<50)return;this.last=time;callback();};this.raf=requestAnimationFrame(tick);}
 dispose(){this.setAnimationLoop(null);for(const r of this.views)r.clear();}
}
