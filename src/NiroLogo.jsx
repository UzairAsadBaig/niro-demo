import { useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { useGLTF } from '@react-three/drei';
import * as THREE from 'three';
import { MeshSurfaceSampler } from 'three/examples/jsm/math/MeshSurfaceSampler.js';
import { SCENE_CONFIG as C } from './scene-config';

const URL = '/niro-logo.glb';
useGLTF.preload(URL);
const { smoothstep } = THREE.MathUtils;

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
// Reveal: each particle leaves the marker after its delay, spirals up around the beam and lands on its point of the logo surface.
const revealVertex = `uniform float time,flight,pixelRatio;attribute vec3 target;attribute float delay,seed,size;varying float vAlpha;
void main(){
 float t=clamp((time-delay)/flight,0.,1.);
 float e=t<.5?4.*t*t*t:1.-pow(-2.*t+2.,3.)/2.;
 vec3 p=mix(position,target,e);
 float a=seed*6.283+(1.-e)*(4.+seed*3.),r=sin(e*3.1416)*(1.2+seed*2.);
 p.xz+=vec2(cos(a),sin(a))*r;
 vec4 mv=modelViewMatrix*vec4(p,1.);gl_Position=projectionMatrix*mv;
 vAlpha=smoothstep(0.,.06,t);
 gl_PointSize=size*pixelRatio*60./-mv.z;
}`;
const pointFragment = `uniform vec3 color;uniform float fade;varying float vAlpha;
void main(){${dot}gl_FragColor=vec4(color*a*vAlpha*fade,1.);}`;

// Devfum's logo trick: the extruded body plus a flat, very bright "bloom layer" on its face, bloomed by postprocessing.
// The glow is on the front face only; the back stays plain brand blue.
export function NiroLogo({ play }) {
  const L = C.logo, D = L.dust, R = L.reveal;
  const { nodes } = useGLTF(URL);
  const geometry = nodes.Niro_Iconmark.geometry;
  const gl = useThree(s => s.gl);
  const group = useRef(), mark = useRef(), startedAt = useRef(null);
  const faceY = useMemo(() => {
    const [x, , z] = L.position, [cx, , cz] = C.cameras.concept.position;
    return Math.atan2(cx - x, cz - z);
  }, [L.position]);
  const body = useMemo(() => new THREE.MeshStandardMaterial({ color: L.color, emissive: L.color, emissiveIntensity: .25, roughness: .3, metalness: .2 }), [L.color]);
  const face = useMemo(() => new THREE.MeshBasicMaterial({ color: new THREE.Color(L.color).multiplyScalar(L.faceStrength), toneMapped: true }), [L.color, L.faceStrength]);
  const glowColor = useMemo(() => new THREE.Color(L.color).multiplyScalar(L.glowStrength), [L.color, L.glowStrength]);
  const glow = useMemo(() => new THREE.MeshBasicMaterial({ color: glowColor.clone(), toneMapped: false }), [glowColor]);
  const mask = useMemo(() => new THREE.MeshBasicMaterial({ color: 0 }), []);
  const glowLayer = (o) => o?.layers.set(1);
  const pointMaterial = (vertexShader, color, extra) => new THREE.ShaderMaterial({
    vertexShader, fragmentShader: pointFragment, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    uniforms: { time: { value: 0 }, fade: { value: 0 }, pixelRatio: { value: gl.getPixelRatio() }, color: { value: color }, ...extra },
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
    return { g, m: pointMaterial(dustVertex, new THREE.Color().setRGB(...D.color).multiplyScalar(D.brightness), { height: { value: L.size * 1.2 } }) };
  }, [D, L.size, gl]);
  const reveal = useMemo(() => {
    const n = R.count, start = new Float32Array(n * 3), target = new Float32Array(n * 3), delay = new Float32Array(n), seed = new Float32Array(n), size = new Float32Array(n);
    const sampler = new MeshSurfaceSampler(new THREE.Mesh(geometry)).build(), v = new THREE.Vector3();
    const base = C.marker.position[1] - L.position[1];
    for (let i = 0; i < n; i++) {
      sampler.sample(v); v.multiplyScalar(L.size); target.set([v.x, v.y, v.z], i * 3);
      const a = Math.random() * Math.PI * 2, r = Math.random() * C.marker.radius;
      start.set([Math.cos(a) * r, base + Math.random() * .3, Math.sin(a) * r], i * 3);
      // Mostly bottom-up, so the mark builds from the beam upwards.
      delay[i] = R.start + R.stagger * (.65 * THREE.MathUtils.clamp(v.y / L.size / .72 + .5, 0, 1) + .35 * Math.random());
      seed[i] = Math.random(); size[i] = 1 + Math.random() * 1.5;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(start, 3));
    g.setAttribute('target', new THREE.BufferAttribute(target, 3));
    g.setAttribute('delay', new THREE.BufferAttribute(delay, 1));
    g.setAttribute('seed', new THREE.BufferAttribute(seed, 1));
    g.setAttribute('size', new THREE.BufferAttribute(size, 1));
    return { g, m: pointMaterial(revealVertex, new THREE.Color(L.color).multiplyScalar(R.brightness), { flight: { value: R.flight } }) };
  }, [R, L.color, geometry, L.size, L.position, gl]);

  useFrame(({ clock, invalidate }) => {
    if (play && startedAt.current === null) startedAt.current = clock.elapsedTime;
    const t = startedAt.current === null ? -1 : clock.elapsedTime - startedAt.current;
    const landed = R.start + R.stagger + R.flight;
    const show = smoothstep(t, landed - .5, landed + .4);
    const flash = Math.exp(-(((t - landed - .3) / .35) ** 2));
    group.current.position.y = L.position[1] + Math.sin(clock.elapsedTime * .8) * .15;
    mark.current.visible = show > 0;
    mark.current.scale.setScalar(L.size * (.94 + .06 * show));
    for (const m of [body, face]) { m.opacity = show; m.transparent = show < 1; }
    glow.color.copy(glowColor).multiplyScalar(show + flash * R.flash);
    reveal.m.uniforms.time.value = t;
    reveal.m.uniforms.fade.value = 1 - smoothstep(t, landed, landed + 1);
    dust.m.uniforms.time.value = clock.elapsedTime;
    dust.m.uniforms.fade.value = smoothstep(t, landed, landed + 1.5);
    invalidate();
  });

  return <group ref={group} position={L.position} rotation-y={faceY}>
    <group ref={mark} scale={L.size}>
      <mesh geometry={geometry} material={body} />
      <mesh geometry={geometry} material={face} position-z={.0505} scale={[1, 1, .0001]} />
      {/* Layer 1 only (bloom pass): the HDR glow face, plus a black body so it is hidden from behind. */}
      <mesh ref={glowLayer} geometry={geometry} material={glow} position-z={.0505} scale={[1, 1, .0001]} />
      <mesh ref={glowLayer} geometry={geometry} material={mask} />
    </group>
    <points geometry={reveal.g} material={reveal.m} frustumCulled={false} />
    <points geometry={dust.g} material={dust.m} frustumCulled={false} />
  </group>;
}
