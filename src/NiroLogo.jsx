import { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { useGLTF } from '@react-three/drei';
import * as THREE from 'three';
import { MeshSurfaceSampler } from 'three/examples/jsm/math/MeshSurfaceSampler.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import snoise from './lib/snoise.glsl?raw';
import { SCENE_CONFIG as C } from './scene-config';
import { story, ramp, useWorld } from './story';

const URL = '/niro-logo.glb';
useGLTF.preload(URL);
const { smoothstep } = THREE.MathUtils;

// Dissolve field over the icon (local units): mostly height, roughened by 3D simplex noise, so the icon builds from the
// bottom up and dissolves from its lower edge with an organic burning front (after the Codrops emissive-dissolve demo).
const field = `${snoise}
uniform float uFreq,uNoise,uMinY,uRangeY,uBuild,uDissolve,uEdge;
float field(vec3 p){return mix(clamp((p.y-uMinY)/uRangeY,0.,1.),snoise(p*uFreq)*.5+.5,uNoise);}`;
// Injected into the icon's materials: discard outside the built/undissolved range and glow along both fronts.
// The glow face also drops alpha on the edge so the energy bloom is added there (alpha marks the plain logo face).
function dissolvable(material, uniforms) {
  material.onBeforeCompile = shader => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vLocal;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvLocal=position;');
    shader.fragmentShader = shader.fragmentShader.replace('#include <common>', `#include <common>\nvarying vec3 vLocal;uniform vec3 uEdgeColor;\n${field}`)
      .replace('#include <dithering_fragment>', `#include <dithering_fragment>
 float f=field(vLocal);
 if(f>uBuild||f<uDissolve)discard;
 float e=max(1.-smoothstep(0.,uEdge,uBuild-f),1.-smoothstep(0.,uEdge,f-uDissolve));
 gl_FragColor=vec4(mix(gl_FragColor.rgb,uEdgeColor,e),gl_FragColor.a*(1.-e));`);
  };
  return material;
}

const dot = `float d=length(gl_PointCoord-.5)*2.;float a=exp(-d*d*7.)*(1.-smoothstep(.75,1.,d));`;
const dustVertex = `uniform float time,pixelRatio,height;attribute float size,phase,speed;varying float vAlpha;
void main(){
 vec3 p=position;
 p.y=mod(p.y+time*speed*.18+height*.5,height)-height*.5;
 p.x+=sin(time*.35*speed+phase*6.283)*.08;
 vec4 mv=modelViewMatrix*vec4(p,1.);gl_Position=projectionMatrix*mv;
 float twinkle=.5+.5*sin(time*speed*1.7+phase*6.283);
 vAlpha=twinkle*twinkle*twinkle*(1.-smoothstep(.3,.5,abs(p.y)/height));
 gl_PointSize=size*pixelRatio*60./-mv.z;
}`;
// Assemble: each particle leaves the inlet where the signal lines end (below the icon) and fans out to its point of
// the icon, landing exactly when the building front reaches it. Dissolve: it leaves as the dissolving front passes and
// drains back into the inlet, where the return lines start.
const revealVertex = `${field}
uniform float time,pixelRatio,uSpan,uScale;attribute vec3 target;attribute float seed,size;varying float vAlpha;
void main(){
 float f=field(target/uScale),t=clamp((uBuild-f)/uSpan+1.,0.,1.);
 float e=t<.5?4.*t*t*t:1.-pow(-2.*t+2.,3.)/2.;
 float dd=clamp((uDissolve-f)/uSpan,0.,1.),g=dd*dd*(3.-2.*dd);
 float k=e*(1.-g),a=seed*6.283;
 vec3 p=mix(position,target,k)+vec3(cos(a),0.,sin(a))*sin(k*3.1416)*(.15+seed*.35);
 vec4 mv=modelViewMatrix*vec4(p,1.);gl_Position=projectionMatrix*mv;
 vAlpha=max(smoothstep(0.,.08,t)*(1.-smoothstep(.85,1.,t)),smoothstep(0.,.05,dd)*(1.-smoothstep(.75,1.,dd)));
 gl_PointSize=size*pixelRatio*60./-mv.z;
}`;
const pointFragment = `uniform vec3 color;uniform float fade;varying float vAlpha;
void main(){${dot}gl_FragColor=vec4(color*a*vAlpha*fade,0.);}`;
// Embers: fine sparks living on the icon surface, shown only near a front; they lift off, curl slightly and fade.
// Stateless (age loops with time), so scrolling backwards just works.
const emberVertex = `${field}
uniform float time,uScale,uPx,uSize,uTravel,uSpeed,pixelRatio;attribute vec3 target;attribute float seed;varying float vAlpha;
void main(){
 float f=field(target/uScale),bb=uBuild-f,bd=f-uDissolve,w=uEdge*3.;
 float band=max(step(0.,bb)*(1.-smoothstep(0.,w,bb)),step(0.,bd)*(1.-smoothstep(0.,w,bd)));
 float age=fract(time*uSpeed*(.6+seed*.8)+seed*7.31);
 vAlpha=band*pow(1.-age,1.5)*smoothstep(0.,.08,age)*(.6+.4*fract(seed*91.7));
 if(vAlpha<.002){gl_Position=vec4(2.,2.,2.,1.);gl_PointSize=0.;return;}
 vec3 dir=normalize(vec3((seed-.5)*.8,1.,(fract(seed*13.1)-.5)*.8));
 float dist=age*uTravel*(.4+seed*.6);
 vec3 p=target+dir*dist+vec3(sin(age*5.+seed*20.),0.,cos(age*4.+seed*11.))*.12*age;
 vec4 mv=modelViewMatrix*vec4(p,1.);gl_Position=projectionMatrix*mv;
 float px=uSize*uPx/-mv.z*(1.-age*.5);
 vAlpha*=min(1.,px/pixelRatio);gl_PointSize=max(px,pixelRatio);
}`;
const emberFragment = `uniform vec3 color;varying float vAlpha;
void main(){float d=length(gl_PointCoord-.5)*2.;if(d>1.)discard;
 gl_FragColor=vec4(color*vAlpha*(exp(-d*d*8.)*.6+exp(-d*d*40.)),0.);}`;
// Additive colour that leaves destination alpha alone (alpha marks the logo face in the energy pass).
const additive = { transparent:true, depthWrite:false, blending:THREE.CustomBlending, blendSrc:THREE.OneFactor, blendDst:THREE.OneFactor, blendSrcAlpha:THREE.ZeroFactor, blendDstAlpha:THREE.OneFactor };

// Devfum's logo trick: the extruded body plus a flat, very bright "bloom layer" on its face, bloomed by postprocessing.
// Scroll drives it: it builds bottom-up from the converging signal particles (stage 3) and dissolves from its lower
// edge into the return streams (stage 4). A multi-part icon GLB (the four official components) flies together.
export function NiroLogo() {
  const L = C.logo, D = L.dust, R = L.reveal, X = L.dissolve, E = L.embers, T = C.timeline;
  const { anchors } = useWorld();
  const { scene: source } = useGLTF(URL);
  const gl = useThree(s => s.gl);
  const group = useRef(), mark = useRef(), parts = useRef([]);
  const position = anchors.NIRO_Assemble;
  const geometries = useMemo(() => {
    source.updateMatrixWorld(true);
    const list = [];
    source.traverse(o => { if (o.isMesh) list.push(o.geometry.clone().applyMatrix4(o.matrixWorld)); });
    return list;
  }, [source]);
  const bounds = useMemo(() => {
    const box = new THREE.Box3();
    geometries.forEach(g => { g.computeBoundingBox(); box.union(g.boundingBox); });
    return { box, centers:geometries.map(g => g.boundingBox.getCenter(new THREE.Vector3())) };
  }, [geometries]);
  // Face the logo toward the camera at the assembly stage.
  const faceY = useMemo(() => {
    const cam = C.camera.keys.find(k => k.s >= 2.5) || C.camera.keys[0];
    return Math.atan2(cam.position[0] - position.x, cam.position[2] - position.z);
  }, [position]);
  // One set of dissolve uniforms shared by the icon materials, the assembly particles and the embers.
  const fronts = useMemo(() => ({
    uFreq:{ value:X.freq }, uNoise:{ value:X.noise }, uEdge:{ value:X.edge }, uBuild:{ value:-1 }, uDissolve:{ value:-1 },
    uMinY:{ value:bounds.box.min.y }, uRangeY:{ value:bounds.box.max.y - bounds.box.min.y },
    uEdgeColor:{ value:new THREE.Color(X.color).multiplyScalar(X.intensity) },
  }), [X, bounds]);
  const body = useMemo(() => dissolvable(new THREE.MeshStandardMaterial({ color:L.color, emissive:L.color, emissiveIntensity:.25, roughness:.3, metalness:.2 }), fronts), [L.color, fronts]);
  const face = useMemo(() => dissolvable(new THREE.MeshBasicMaterial({ color:new THREE.Color(L.color).multiplyScalar(L.faceStrength) }), fronts), [L.color, L.faceStrength, fronts]);
  const glowColor = useMemo(() => new THREE.Color(L.color).multiplyScalar(L.glowStrength), [L.color, L.glowStrength]);
  // Pulled toward the camera so it always wins the depth test against the face it sits on.
  const glow = useMemo(() => dissolvable(new THREE.MeshBasicMaterial({ color:glowColor.clone(), toneMapped:false, polygonOffset:true, polygonOffsetFactor:-2, polygonOffsetUnits:-8 }), fronts), [glowColor, fronts]);
  const glowLayer = (o) => o?.layers.set(1);
  const pointMaterial = (vertexShader, color, extra) => new THREE.ShaderMaterial({
    vertexShader, fragmentShader:pointFragment, ...additive,
    uniforms:{ time:{ value:0 }, fade:{ value:1 }, pixelRatio:{ value:gl.getPixelRatio() }, color:{ value:color }, ...extra },
  });
  const dust = useMemo(() => {
    const n = D.count, pos = new Float32Array(n * 3), size = new Float32Array(n), phase = new Float32Array(n), speed = new Float32Array(n);
    const bell = () => Math.random() + Math.random() + Math.random() - 1.5;
    for (let i = 0; i < n; i++) {
      pos.set([bell() * L.size * .55, (Math.random() - .5) * L.size * 1.2, bell() * L.size * .2], i * 3);
      size[i] = .8 + Math.random() ** 3 * 3;
      phase[i] = Math.random(); speed[i] = .5 + Math.random();
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('size', new THREE.BufferAttribute(size, 1));
    g.setAttribute('phase', new THREE.BufferAttribute(phase, 1));
    g.setAttribute('speed', new THREE.BufferAttribute(speed, 1));
    return { g, m:pointMaterial(dustVertex, new THREE.Color().setRGB(...D.color).multiplyScalar(D.brightness), { height:{ value:L.size * 1.2 } }) };
  }, [D, L.size, gl]);
  // Surface samples (scaled to world size) shared by the assembly particles and the embers.
  const sample = useMemo(() => {
    const merged = geometries.length > 1 ? mergeGeometries(geometries.map(g => g.index ? g.toNonIndexed() : g)) : geometries[0];
    const sampler = new MeshSurfaceSampler(new THREE.Mesh(merged)).build(), v = new THREE.Vector3();
    return n => { const out = new Float32Array(n * 3); for (let i = 0; i < n; i++) { sampler.sample(v); v.multiplyScalar(L.size).toArray(out, i * 3); } return out; };
  }, [geometries, L.size]);
  const reveal = useMemo(() => {
    // Inlet: where SignalStreams ends the source lines and starts the return lines (C.logo.size * .3 below the anchor).
    const n = R.count, start = new Float32Array(n * 3), seed = new Float32Array(n), size = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, r = Math.random() * .25;
      start.set([Math.cos(a) * r, -L.size * .3 + (Math.random() - .5) * .3, Math.sin(a) * r], i * 3);
      seed[i] = Math.random(); size[i] = .7 + Math.random();
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(start, 3));
    g.setAttribute('target', new THREE.BufferAttribute(sample(n), 3));
    g.setAttribute('seed', new THREE.BufferAttribute(seed, 1));
    g.setAttribute('size', new THREE.BufferAttribute(size, 1));
    return { g, m:pointMaterial(revealVertex, new THREE.Color(L.color).multiplyScalar(R.brightness), { ...fronts, uSpan:{ value:R.span }, uScale:{ value:L.size } }) };
  }, [R, L.color, L.size, sample, fronts, gl]);
  const embers = useMemo(() => {
    const n = E.count, g = new THREE.BufferGeometry(), seed = new Float32Array(n).map(Math.random), target = sample(n);
    g.setAttribute('position', new THREE.BufferAttribute(target.slice(), 3));
    g.setAttribute('target', new THREE.BufferAttribute(target, 3));
    g.setAttribute('seed', new THREE.BufferAttribute(seed, 1));
    const m = new THREE.ShaderMaterial({ vertexShader:emberVertex, fragmentShader:emberFragment, ...additive,
      uniforms:{ ...fronts, time:{ value:0 }, uScale:{ value:L.size }, uPx:{ value:1 }, uSize:{ value:E.size }, uTravel:{ value:E.travel }, uSpeed:{ value:E.speed },
        pixelRatio:{ value:gl.getPixelRatio() }, color:{ value:new THREE.Color(E.color).multiplyScalar(E.brightness) } } });
    return { g, m };
  }, [E, L.size, sample, fronts, gl]);
  useEffect(() => () => { for (const m of [body, face, glow, dust.m, reveal.m, embers.m]) m.dispose(); dust.g.dispose(); reveal.g.dispose(); embers.g.dispose(); }, [body, face, glow, dust, reveal, embers]);

  useFrame(({ clock, camera, size }) => {
    const s = story.s, a = ramp(s, T.assemble), d = ramp(s, T.dissolve), span = R.span, edge = X.edge;
    group.current.visible = a > 0 && d < 1;
    group.current.position.y = position.y + Math.sin(clock.elapsedTime * .8) * .15;
    // Fronts in field units (0 = bottom, 1 = top). Particles take `span` to fly, so the fronts start/end beyond 0..1.
    fronts.uBuild.value = a <= 0 ? -1 : a >= 1 ? 2 : -span + a * (1 + span + edge + .02);
    fronts.uDissolve.value = d <= 0 ? -1 : -edge + d * (1 + edge + span);
    // The parts fly in from slightly apart (a single-mesh icon has no spread and just builds in place).
    parts.current.forEach((p, k) => {
      if (!p) return;
      const e = 1 - (1 - ramp(a, [k * .08, .55 + k * .08])) ** 3;
      p.position.copy(bounds.centers[k]).multiplyScalar(R.spread * (1 - e) / L.size);
      p.rotation.z = (1 - e) * (k % 2 ? .5 : -.5);
    });
    mark.current.scale.setScalar(L.size);
    const flash = Math.exp(-(((a - .95) / .05) ** 2));
    glow.color.copy(glowColor).multiplyScalar(1 + flash * R.flash);
    reveal.m.uniforms.time.value = clock.elapsedTime;
    embers.m.uniforms.time.value = clock.elapsedTime;
    embers.m.uniforms.uPx.value = size.height * gl.getPixelRatio() / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2));
    dust.m.uniforms.time.value = clock.elapsedTime;
    dust.m.uniforms.fade.value = smoothstep(a, .7, 1) * (1 - Math.min(1, d * 2));
  });

  // Icon meshes skip the bloom passes' black stand-ins (those can't follow the dissolve); the glow face is the bloom source.
  return <group ref={group} position={position} rotation-y={faceY}>
    <group ref={mark} scale={L.size}>
      {geometries.map((g, k) => <group key={k} ref={o => { parts.current[k] = o; }}>
        <mesh geometry={g} material={body} userData={{ noOcclude:true }} />
        <mesh geometry={g} material={face} position-z={.0505} scale={[1, 1, .0001]} userData={{ noOcclude:true }} />
        {/* Layer 1 only (energy pass): the HDR glow face that gets bloomed. */}
        <mesh ref={glowLayer} geometry={g} material={glow} position-z={.0505} scale={[1, 1, .0001]} />
      </group>)}
    </group>
    <points geometry={reveal.g} material={reveal.m} frustumCulled={false} userData={{ energy:true }} />
    <points geometry={embers.g} material={embers.m} frustumCulled={false} userData={{ energy:true }} />
    <points geometry={dust.g} material={dust.m} frustumCulled={false} userData={{ energy:true }} />
  </group>;
}
