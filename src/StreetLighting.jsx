import { useLayoutEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import lighting from './lamp-lighting.json';
import poolData from './light-pools.json';
import { SCENE_CONFIG as C } from './scene-config';

function radialTexture(){
  const n=C.lighting.poolTextureSize,data=new Uint8Array(n*n*4);
  for(let y=0;y<n;y++)for(let x=0;x<n;x++){
    const r=Math.hypot((x+.5)/n*2-1,(y+.5)/n*2-1);
    const t=THREE.MathUtils.clamp((1-r)/.35,0,1);
    const edge=t*t*(3-2*t),alpha=r>=1?0:Math.exp(-r*r*4.5)*edge;
    const k=(y*n+x)*4;data[k]=255;data[k+1]=255;data[k+2]=255;data[k+3]=Math.round(alpha*255);
  }
  const map=new THREE.DataTexture(data,n,n,THREE.RGBAFormat);
  map.magFilter=THREE.LinearFilter;map.minFilter=THREE.LinearMipmapLinearFilter;map.generateMipmaps=true;map.needsUpdate=true;
  return map;
}
export function StreetLighting({ mode }) {
  const glow=useRef(),pools=useRef(),lights=useRef([]);
  const points=useMemo(()=>[...lighting.bulbs,...poolData.lanterns].map(p=>new THREE.Vector3(...p)),[]);
  const texture=useMemo(radialTexture,[]);
  const material=useMemo(()=>new THREE.ShaderMaterial({
    transparent:true,depthWrite:false,blending:THREE.AdditiveBlending,
    uniforms:{strength:{value:1}},
    vertexShader:`varying vec2 vUv;void main(){vUv=uv;vec4 center=modelViewMatrix*instanceMatrix*vec4(0.,0.,0.,1.);center.xy+=position.xy;center.z+=.12;gl_Position=projectionMatrix*center;}`,
    fragmentShader:`varying vec2 vUv;uniform float strength;void main(){float r=length(vUv-.5)*2.;float edge=1.-smoothstep(.6,1.,r);float core=exp(-r*r*30.);float halo=exp(-r*r*11.);gl_FragColor=vec4(vec3(4.,2.45,1.18)*strength,(core*.7+halo*.3)*edge*${C.lighting.bulbOpacity});}`,
  }),[]);
  const poolMaterial=useMemo(()=>new THREE.ShaderMaterial({
    transparent:true,depthWrite:false,depthTest:true,blending:THREE.AdditiveBlending,polygonOffset:true,polygonOffsetFactor:-1,polygonOffsetUnits:-1,
    uniforms:{map:{value:texture},strength:{value:1}},
    vertexShader:`attribute float poolOpacity;varying vec2 vUv;varying float opacity;void main(){vUv=uv;opacity=poolOpacity;gl_Position=projectionMatrix*modelViewMatrix*instanceMatrix*vec4(position,1.);}`,
    fragmentShader:`uniform sampler2D map;uniform float strength;varying vec2 vUv;varying float opacity;void main(){float a=texture2D(map,vUv).a;gl_FragColor=vec4(vec3(1.,.55,.22),a*opacity*strength);}`,
  }),[texture]);
  useLayoutEffect(()=>{
    const matrix=new THREE.Matrix4();points.forEach((p,i)=>glow.current.setMatrixAt(i,matrix.makeTranslation(p.x,p.y+.085,p.z)));glow.current.instanceMatrix.needsUpdate=true;
    const q=new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.PI/2,0,0));
    const opacity=[];
    poolData.pools.forEach(([x,y,z,rx,rz,a],i)=>{const street=i<lighting.bulbs.length;matrix.compose(new THREE.Vector3(x,y,z),q,new THREE.Vector3((street?C.lighting.poolRadius:rx)*2,(street?C.lighting.poolRadius:rz)*2,1));pools.current.setMatrixAt(i,matrix);opacity.push(street?C.lighting.poolOpacity:a);});
    pools.current.geometry.setAttribute('poolOpacity',new THREE.InstancedBufferAttribute(new Float32Array(opacity),1));pools.current.instanceMatrix.needsUpdate=true;
    return()=>{material.dispose();poolMaterial.dispose();texture.dispose();};
  },[points,material,poolMaterial,texture]);
  useFrame(({camera})=>{
    material.uniforms.strength.value=mode==='day'?.15:1;poolMaterial.uniforms.strength.value=mode==='day'?.1:1;
    const nearest=points.map(p=>({p,d:p.distanceToSquared(camera.position)})).sort((a,b)=>a.d-b.d).slice(0,4);
    nearest.forEach(({p,d},i)=>{if(!lights.current[i])return;lights.current[i].position.copy(p);lights.current[i].intensity=mode==='day'||d>45*45?0:C.lighting.nearbyLightIntensity;});
  });
  return <>
    <instancedMesh name="Lamp_bulb_cores" userData={{bloom:true}} ref={glow} args={[null,null,points.length]} frustumCulled={false} material={material}><planeGeometry args={[C.lighting.bulbSize,C.lighting.bulbSize]}/></instancedMesh>
    <instancedMesh name="Localized_light_pools" userData={{lightPool:true}} ref={pools} args={[null,null,poolData.pools.length]} frustumCulled={false} material={poolMaterial}><planeGeometry args={[1,1]}/></instancedMesh>
    {[0,1,2,3].map(i=><pointLight key={i} ref={o=>{lights.current[i]=o;}} color="#ffc582" intensity={0} distance={C.lighting.nearbyLightDistance} decay={2}/>)}
  </>;
}

