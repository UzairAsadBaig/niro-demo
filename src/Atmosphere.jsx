import { useEffect, useMemo } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { BloomEffect } from 'postprocessing';
import { SCENE_CONFIG as C } from './scene-config';
const vertexShader=`varying vec2 vUv;void main(){vUv=uv;gl_Position=vec4(position.xy,0.,1.);}`;
const blur=`varying vec2 vUv;uniform sampler2D map;uniform vec2 direction;uniform float threshold;
void main(){vec3 sum=vec3(0.);float weight=0.;for(int i=-6;i<=6;i++){float x=float(i);float w=exp(-x*x/12.);vec3 c=texture2D(map,vUv+direction*x).rgb;sum+=max(c-vec3(threshold),vec3(0.))*w;weight+=w;}gl_FragColor=vec4(sum/weight,1.);}`;
const composite=`varying vec2 vUv;uniform sampler2D sceneMap,depthMap,bloomMap;uniform mat4 inverseProjection,cameraWorld;uniform vec3 cameraPositionWorld,skyTop,skyHorizon,smokeColor;uniform float time,smokeAmount,saturation,vignette;uniform vec4 bounds;uniform sampler2D logoBloomMap,logoFaceMap;uniform float logoDist,logoRadius;uniform float start,density,heightFalloff,upperDensity,edgeWidth,strength,bloomStrength,logoBloomStrength;
float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
float vnoise(vec2 p){vec2 i=floor(p),f=fract(p),u=f*f*(3.-2.*f);return mix(mix(hash(i),hash(i+vec2(1,0)),u.x),mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),u.x),u.y);}
float fbm(vec2 p){float v=0.,a=.5;for(int i=0;i<5;i++){v+=a*vnoise(p);p=p*2.03+vec2(1.7,9.2);a*=.5;}return v;}
void main(){
 float depth=texture2D(depthMap,vUv).r;
 vec3 sky=mix(skyHorizon,skyTop,smoothstep(.15,1.,vUv.y));
 vec3 color=texture2D(sceneMap,vUv).rgb;
 vec4 p=inverseProjection*vec4(vUv*2.-1.,depth*2.-1.,1.);p/=p.w;vec3 world=(cameraWorld*p).xyz;
 float distanceToPoint=length(world-cameraPositionWorld);
 float travel=max(0.,distanceToPoint-start);
 // Exponential height integral over the distant segment; a little aerial density remains above it.
 vec3 ray=normalize(world-cameraPositionWorld);
 // Billowing smoke behind the city, anchored to world directions (azimuth/elevation) so it holds still while orbiting; drifts slowly.
 vec2 sq=vec2(atan(ray.x,ray.z)*2.2+time*.006,ray.y*7.);
 float smoke=fbm(sq+vec2(fbm(sq*1.4+time*.012),fbm(sq*1.4-time*.009))*1.6);
 sky=mix(sky,smokeColor,smoothstep(.3,.85,smoke)*smokeAmount);
 float h0=max(0.,(cameraPositionWorld+ray*min(start,distanceToPoint)).y);
 float h1=max(0.,world.y);float dh=(h1-h0)*heightFalloff;
 float integral=abs(dh)<.001?exp(-h0*heightFalloff):(exp(-h0*heightFalloff)-exp(-h1*heightFalloff))/dh;
 float optical=travel*density*(upperDensity+integral);
 // Patchy density and low drifting mist between the distant blocks, so the far city dissolves into the smoke.
 optical*=mix(.55,1.45,fbm(world.xz*.035+vec2(time*.015,0.)));
 optical+=smoothstep(10.,70.,travel)*exp(-max(world.y,0.)*.2)*.4*fbm(world.xz*.06-vec2(0.,time*.01));
 float fog=1.-exp(-optical*strength);
 float edge=min(min(world.x-bounds.x,bounds.y-world.x),min(world.z-bounds.z,bounds.w-world.z));
 float edgeFade=1.-smoothstep(0.,edgeWidth,edge);
 float fade=max(fog,edgeFade);
 // Map edges near the camera sink into darkness (like a vignette); far edges dissolve into the smoke.
 vec3 edgeColor=mix(skyTop*.6,sky,smoothstep(start*.7,start*1.2,distanceToPoint));
 if(depth>=.999999){if(ray.y<-.001)sky=mix(skyTop,sky,smoothstep(start*.7,start*1.2,-cameraPositionWorld.y/ray.y));color=sky;fade=1.;}else{color=mix(mix(color,sky,fog),edgeColor,edgeFade);}
 // Cool, desaturated grade like the storyboard; the logo face and the glows added below keep their full colour.
 float logoFace=min(texture2D(logoFaceMap,vUv).b,1.);
 color=mix(vec3(dot(color,vec3(.2126,.7152,.0722))),color,mix(saturation,1.,logoFace));
 // Devfum-style postprocessing bloom of the logo's glow layer (see NiroLogo.jsx). Not fogged, so the halo can reach the sky.
 // Anything clearly nearer than the logo hides its glow.
 // The face keeps its own colour: bloom is only added outside the logo silhouette (tone mapping would wash the face out).
 color+=texture2D(logoBloomMap,vUv).rgb*logoBloomStrength*step(logoDist-logoRadius,distanceToPoint)*(1.-logoFace);
 vec3 bloom=texture2D(bloomMap,vUv).rgb;
 color+=bloom*bloomStrength*(1.-fade);
 gl_FragColor=vec4(color,1.);
 #include <tonemapping_fragment>
 #include <colorspace_fragment>
 gl_FragColor.rgb*=1.-smoothstep(.3,.95,length((vUv-.5)*vec2(1.3,1.)))*vignette;
 float noise=fract(52.9829189*fract(dot(gl_FragCoord.xy,vec2(.06711056,.00583715))))-.5;
 gl_FragColor.rgb+=noise*0.002352941176470588;
}`;
export function Atmosphere({strength=1,mode='night',bloomEnabled=true,logoBloom=C.logo.bloom.intensity,logoBloomRadius=C.logo.bloom.radius}){
 const {gl,size,invalidate}=useThree();
 const r=useMemo(()=>{
  const source=new THREE.WebGLRenderTarget(1,1,{type:THREE.HalfFloatType});source.samples=4;source.depthTexture=new THREE.DepthTexture(1,1,THREE.UnsignedIntType);
  const emission=new THREE.WebGLRenderTarget(1,1,{type:THREE.HalfFloatType});emission.samples=4;
  const logo=new THREE.WebGLRenderTarget(1,1,{type:THREE.HalfFloatType});logo.samples=4;
  const ping=new THREE.WebGLRenderTarget(1,1,{type:THREE.HalfFloatType,depthBuffer:false});const pong=ping.clone();
  const b=new THREE.ShaderMaterial({vertexShader,fragmentShader:blur,depthTest:false,depthWrite:false,toneMapped:false,uniforms:{map:{value:null},direction:{value:new THREE.Vector2()},threshold:{value:0}}});
  const f=C.atmosphere;
  const logoPosition=new THREE.Vector3(...C.logo.position);
  const c=new THREE.ShaderMaterial({vertexShader,fragmentShader:composite,depthTest:false,depthWrite:false,uniforms:{sceneMap:{value:source.texture},depthMap:{value:source.depthTexture},bloomMap:{value:pong.texture},inverseProjection:{value:new THREE.Matrix4()},cameraWorld:{value:new THREE.Matrix4()},cameraPositionWorld:{value:new THREE.Vector3()},skyTop:{value:new THREE.Color(f.top)},skyHorizon:{value:new THREE.Color(f.horizon)},bounds:{value:new THREE.Vector4(...f.bounds)},start:{value:120},density:{value:f.density},heightFalloff:{value:f.heightFalloff},upperDensity:{value:f.upperDensity},edgeWidth:{value:f.edgeFadeWidth},smokeColor:{value:new THREE.Color(f.smoke)},smokeAmount:{value:f.smokeAmount},saturation:{value:f.saturation},vignette:{value:f.vignette},time:{value:0},strength:{value:1},bloomStrength:{value:C.bloom.strength},logoBloomMap:{value:null},logoFaceMap:{value:null},logoDist:{value:1e9},logoRadius:{value:C.logo.size*.6},logoBloomStrength:{value:C.logo.bloom.intensity}}});
  const lb=C.logo.bloom,glow=new BloomEffect({luminanceThreshold:lb.threshold,luminanceSmoothing:lb.smoothing,levels:lb.levels,radius:lb.radius});glow.initialize(gl,false,THREE.HalfFloatType);
  const quad=new THREE.Mesh(new THREE.PlaneGeometry(2,2),b);quad.frustumCulled=false;const screen=new THREE.Scene();screen.add(quad);
  return {logoPosition,source,emission,logo,ping,pong,b,c,glow,quad,screen,camera:new THREE.Camera(),materials:new Map()};
 },[]);
 useEffect(()=>{const d=gl.getPixelRatio();r.source.setSize(size.width*d,size.height*d);r.glow.setSize(size.width*d,size.height*d);for(const t of [r.emission,r.logo,r.ping,r.pong])t.setSize(Math.max(1,Math.round(size.width*d*C.bloom.resolution)),Math.max(1,Math.round(size.height*d*C.bloom.resolution)));invalidate();},[size,gl,r,invalidate]);
 useEffect(()=>{r.c.uniforms.strength.value=strength;r.c.uniforms.bloomStrength.value=bloomEnabled?C.bloom.strength:0;r.c.uniforms.logoBloomStrength.value=bloomEnabled?logoBloom:0;r.glow.mipmapBlurPass.radius=logoBloomRadius;invalidate();},[r,strength,mode,bloomEnabled,logoBloom,logoBloomRadius,invalidate]);
 useEffect(()=>()=>{for(const t of [r.source,r.emission,r.logo,r.ping,r.pong])t.dispose();r.b.dispose();r.c.dispose();r.glow.dispose();r.quad.geometry.dispose();r.materials.forEach(m=>m.dispose());},[r]);
 useFrame(({scene,camera,controls,clock},delta)=>{
  gl.setRenderTarget(r.source);gl.clear();gl.render(scene,camera);const geometryCalls=gl.info.render.calls,triangles=gl.info.render.triangles;
  if(bloomEnabled&&logoBloom>0){
   // Logo glow layer lives on layer 1: render it alone, then bloom that (threshold 0), so its colour is independent of the displayed face.
   const bg=scene.background;scene.background=null;camera.layers.set(1);gl.setRenderTarget(r.logo);gl.clear();gl.render(scene,camera);camera.layers.set(0);scene.background=bg;
   r.glow.update(gl,r.logo,delta);r.c.uniforms.logoBloomMap.value=r.glow.texture;r.c.uniforms.logoFaceMap.value=r.logo.texture;
  }
  let bloomCalls=0;
  if(bloomEnabled){
  const originals=[],hidden=[];const selected=new Set();
  scene.traverse(o=>{if(!o.isMesh)return;const m=o.material;
   if(o.userData.lightPool){hidden.push([o,o.visible]);o.visible=false;return;}
   if(o.userData.bloom){selected.add(o.name||'cyan marker');return;}
   const lamp=o.name==='Street_lamps_instanced';
   const key=m.uuid+(lamp?':lamp':':black');
   if(!r.materials.has(key))r.materials.set(key,new THREE.MeshBasicMaterial({color:lamp?m.emissive.clone().multiplyScalar(m.emissiveIntensity||1):new THREE.Color(0),map:lamp?m.emissiveMap:null,side:m.side,toneMapped:false}));
   if(lamp)selected.add(o.name);
   originals.push([o,m]);o.material=r.materials.get(key);
  });
  const bg=scene.background,shadow=gl.shadowMap.enabled;scene.background=new THREE.Color(0);gl.shadowMap.enabled=false;
  gl.setRenderTarget(r.emission);gl.clear();gl.render(scene,camera);bloomCalls=gl.info.render.calls;
  originals.forEach(([o,m])=>o.material=m);hidden.forEach(([o,v])=>o.visible=v);scene.background=bg;gl.shadowMap.enabled=shadow;
  r.quad.material=r.b;r.b.uniforms.map.value=r.emission.texture;r.b.uniforms.threshold.value=C.bloom.threshold;r.b.uniforms.direction.value.set((1+C.bloom.radius*3)/r.ping.width,0);gl.setRenderTarget(r.ping);gl.render(r.screen,r.camera);
  r.b.uniforms.map.value=r.ping.texture;r.b.uniforms.threshold.value=0;r.b.uniforms.direction.value.set(0,(1+C.bloom.radius*3)/r.pong.height);gl.setRenderTarget(r.pong);gl.render(r.screen,r.camera);
  window.__cityBloomSources=[...selected];
  }
  const u=r.c.uniforms;u.time.value=clock.elapsedTime;u.logoDist.value=camera.position.distanceTo(r.logoPosition);u.inverseProjection.value.copy(camera.projectionMatrixInverse);u.cameraWorld.value.copy(camera.matrixWorld);u.cameraPositionWorld.value.copy(camera.position);u.start.value=Math.max(15,camera.position.distanceTo(controls?.target||new THREE.Vector3())-C.atmosphere.depthStartOffset);
  r.quad.material=r.c;gl.setRenderTarget(null);gl.render(r.screen,r.camera);
  gl.__cityFrameMetrics={calls:geometryCalls+bloomCalls+(bloomEnabled?3:1),geometryCalls,bloomCalls,postPasses:bloomEnabled?3:1,bloomEnabled,triangles,shadowPassesExcluded:true};
 },1);
 return null;
}

export function CityEnvironment(){
  const {gl,scene,invalidate}=useThree();
  useEffect(()=>{
    const canvas=document.createElement('canvas');canvas.width=1024;canvas.height=512;const ctx=canvas.getContext('2d');
    const gradient=ctx.createLinearGradient(0,0,0,512);gradient.addColorStop(0,'#687e99');gradient.addColorStop(.48,'#273747');gradient.addColorStop(.57,'#101b25');gradient.addColorStop(1,'#070a0d');ctx.fillStyle=gradient;ctx.fillRect(0,0,1024,512);
    const sky=ctx.createRadialGradient(670,120,5,670,120,140);sky.addColorStop(0,'#b0becb');sky.addColorStop(.2,'#7088a0');sky.addColorStop(1,'#43556900');ctx.fillStyle=sky;ctx.fillRect(0,0,1024,512);
    const map=new THREE.CanvasTexture(canvas);map.colorSpace=THREE.SRGBColorSpace;map.mapping=THREE.EquirectangularReflectionMapping;
    const generator=new THREE.PMREMGenerator(gl);const env=generator.fromEquirectangular(map);
    scene.environment=env.texture;scene.environmentIntensity=.65;invalidate();
    return()=>{scene.environment=null;env.dispose();map.dispose();generator.dispose();};
  },[gl,scene,invalidate]);
  return null;
}



