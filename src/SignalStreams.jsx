import { useEffect, useMemo } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { SCENE_CONFIG as C } from './scene-config';
import { story, ramp, ease, useWorld, ft01Live } from './story';

// GPU particle streams. Every route is baked into one row of a float texture; each particle only stores its route,
// phase, speed and tube offset, and the vertex shader flows it along the curve. The CPU only updates a head/tail
// window per route from story time, so ~50k particles cost one draw call.
const SAMPLES = 512, MAX_ROUTES = 24;
const v3 = p => new THREE.Vector3(...p);

// Shared by the particles and the lines: the route lookup and the frame around the (swaying) stream axis.
const common = `
uniform sampler2D paths;uniform float time,scale,rows,intensity;uniform vec4 state[${MAX_ROUTES}],info[${MAX_ROUTES}];
uniform vec3 deep,bright,sparkle;
vec3 at(float row,float u,out vec3 tangent){
 float x=clamp(u,0.,1.)*${SAMPLES - 1}.,i=min(floor(x),${SAMPLES - 2}.),v=(row+.5)/rows;
 vec3 a=texture2D(paths,vec2((i+.5)/${SAMPLES}.,v)).xyz,b=texture2D(paths,vec2((i+1.5)/${SAMPLES}.,v)).xyz;
 tangent=b-a;return mix(a,b,x-i);
}
// Axis point at u, its tangent T and normals N/B; taper pinches the tube at both ends and at the user anchor.
vec3 axis(int r,float u,out vec3 T,out vec3 N,out vec3 B,out float taper){
 vec4 inf=info[r];float len=inf.x,m=u*len;
 vec3 p=at(float(r),u,T);T=normalize(T+1e-6);
 vec3 ref=normalize(mix(vec3(0.,1.,0.),vec3(1.,0.,0.),smoothstep(.6,.95,abs(T.y))));
 N=normalize(cross(T,ref));B=cross(N,T);
 taper=smoothstep(0.,2.5,m)*smoothstep(0.,2.5,len-m)*mix(.15,1.,smoothstep(0.,3.5,abs(m-inf.y*len)));
 float sway=sin(m*.21+time*.7+float(r)*1.7)*.22+sin(m*.53-time*.45+float(r))*.08;
 return p+N*sway*taper;
}`;
const vertexShader = `${common}
attribute vec4 aPath;attribute vec4 aMisc;attribute float aTone,aWisp;
varying vec3 vColor;varying float vAlpha,vWisp,vAngle;
void main(){
 int r=int(aPath.x+.5);vec4 st=state[r],inf=info[r];
 float len=inf.x,seed=aPath.w,u=fract(aPath.y+time*aPath.z);
 // Outside the visible window (tail..head): park the vertex outside the clip volume.
 if(u>st.x||u<st.y||st.z<=0.){gl_Position=vec4(2.,2.,2.,1.);gl_PointSize=0.;return;}
 vec3 T,N,B;float taper;vec3 p=axis(r,u,T,N,B,taper);
 float m=u*len;
 // Particles orbit the stream axis in two counter-rotating strands.
 float ang=seed*6.2832+m*.45*sign(seed-.5)+time*(.5+seed);
 vec2 o=mat2(cos(ang),sin(ang),-sin(ang),cos(ang))*aMisc.xy;
 p+=(N*o.x+B*o.y)*inf.z*taper;
 float behind=(st.x-u)*len,hot=st.x<.999?exp(-behind*.8):0.;
 vec4 mv=modelViewMatrix*vec4(p,1.);gl_Position=projectionMatrix*mv;
 float size=aMisc.z*(1.+hot*.6)*scale/-mv.z;
 float a=aMisc.w*st.z*smoothstep(st.y*len,st.y*len+2.5,m)*(.62+.38*sin(time*(2.+seed*5.)+seed*40.));
 a*=max(.3,min(1.,size*size/2.25));gl_PointSize=max(size,1.5);
 vAlpha=a;vWisp=aWisp;vAngle=seed*6.283+time*(.3+seed*.5);
 vec3 c=aTone>.97?sparkle:mix(deep,bright,aTone*.85);
 vColor=mix(c,sparkle,hot*.3)*intensity*(1.+hot*1.5);
}`;
// Dots get a soft gaussian with a hot core; wisps use the rotating smoke sprite (particle.png, from the emissive-dissolve demo).
const fragmentShader = `uniform sampler2D map;varying vec3 vColor;varying float vAlpha,vWisp,vAngle;
void main(){
 if(vWisp>.5){vec2 c=(gl_PointCoord-.5)*mat2(cos(vAngle),sin(vAngle),-sin(vAngle),cos(vAngle))+.5;gl_FragColor=vec4(vColor*vAlpha*texture2D(map,c).r,0.);return;}
 float d=length(gl_PointCoord-.5)*2.;if(d>1.)discard;
 float g=exp(-d*d*6.)*(1.-d*d),core=exp(-d*d*28.);
 gl_FragColor=vec4(vColor*vAlpha*(g*.6+core*.85),0.);}`;

// Light lines (the concept's look): a few thin strands per route that braid around the stream axis, drawn as
// screen-facing ribbons so they stay crisp at any distance. Pulses of light travel along them toward the head.
const lineVertex = `${common}
uniform vec2 res;uniform float lineWidth,lineBright,px;attribute vec4 aLine;
varying vec3 vColor;varying float vAlpha,vSide;
void main(){
 int r=int(aLine.x+.5);vec4 st=state[r],inf=info[r];
 if(st.z<=0.||st.x<=st.y){gl_Position=vec4(2.,2.,2.,1.);return;}
 float len=inf.x,u=clamp(aLine.y,st.y,st.x),m=u*len,strand=aLine.w;
 vec3 T,N,B;float taper;vec3 p=axis(r,u,T,N,B,taper);
 float ang=strand*2.094+m*(.3+strand*.08)*(mod(strand,2.)>.5?-1.:1.)+time*.4,rad=inf.z*(.18+.1*strand);
 p+=(N*cos(ang)+B*sin(ang))*rad*taper;
 mat4 mvp=projectionMatrix*modelViewMatrix;vec4 c0=mvp*vec4(p,1.),c1=mvp*vec4(p+T*.25,1.);
 vec2 dir=normalize((c1.xy/c1.w-c0.xy/c0.w)*res+1e-6),nrm=vec2(-dir.y,dir.x);
 float half_=clamp(lineWidth*scale/c0.w,1.4*px,4.*px);
 c0.xy+=nrm*aLine.z*half_*2./res*c0.w;gl_Position=c0;
 vSide=aLine.z;
 float behind=(st.x-u)*len,hot=st.x<.999?exp(-behind*.9):0.;
 float pulse=pow(.5+.5*sin(m*.8-time*6.+strand*2.3+float(r)),14.);
 vAlpha=lineBright*st.z*smoothstep(st.y*len,st.y*len+4.,m)*(.5+pulse*1.2+hot*1.8)*mix(.6,1.,taper);
 vColor=mix(mix(deep,bright,.6),sparkle,hot*.25+pulse*.2)*intensity;
}`;
const lineFragment = `varying vec3 vColor;varying float vAlpha,vSide;
void main(){float d=abs(vSide);gl_FragColor=vec4(vColor*vAlpha*(exp(-d*d*14.)+exp(-d*d*3.)*.22),0.);}`;

// One ribbon per strand per route: two vertices (side ∓1) at each u, stitched into quads.
function lineGeometry(routes, strands) {
  const attr = [], index = [];
  routes.forEach((r, i) => {
    const n = Math.min(SAMPLES, Math.max(48, Math.round(r.length * 5)));
    for (let k = 0; k < (r.strands ?? strands); k++) {
      const first = attr.length / 4;
      for (let j = 0; j < n; j++) {
        attr.push(i, j / (n - 1), -1, k, i, j / (n - 1), 1, k);
        if (j) { const a = first + (j - 1) * 2; index.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
      }
    }
  });
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(attr.length / 4 * 3), 3));
  g.setAttribute('aLine', new THREE.Float32BufferAttribute(attr, 4));
  g.setIndex(index);
  return g;
}

// Deterministic randomness so the streams look identical between reviews.
function rng(seed) { return () => { seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }

function buildRoutes(world) {
  const { anchors, paths } = world, user = anchors.User, logo = anchors.NIRO_Assemble;
  const bottom = logo.clone().setY(logo.y - C.logo.size * .3), at = p => typeof p === 'string' ? anchors[p].clone() : v3(p);
  const sources = C.routes.sources.map((r, i, all) => {
    const phi = i / all.length * Math.PI * 2, ring = (k, rad, h) => user.clone().add(new THREE.Vector3(Math.cos(phi + k) * rad, h, Math.sin(phi + k) * rad));
    // From the source along the streets to the user anchor, then a braided climb into the assembly point.
    const points = paths[r.id] || [at(r.from), ...r.via.map(v3), user.clone().setY(user.y + .55), ring(.4, .55, 3.2), ring(2.4, .95, 7.2), ring(4.4, .6, 10.8), bottom];
    return { ...r, kind:'source', index:i, points, mark:user };
  });
  const returns = C.routes.returns.map((r, j) => {
    const dir = (r.via[0] ? v3(r.via[0]) : at(r.to)).sub(user).setY(0).normalize();
    const touch = user.clone().addScaledVector(dir, 2.4).setY(user.y + 1);
    const end = () => r.to === 'FT01_Live' ? ft01Live(story.s, world) : at(r.to);
    const head = paths[r.id] ? null : [bottom, user.clone().addScaledVector(dir, 1).setY(user.y + 6.5), touch, ...r.via.map(v3)];
    return { ...r, kind:'return', index:j, head, points:paths[r.id] || [...head, end()], end, dynamic:!paths[r.id] && r.to === 'FT01_Live', mark:touch };
  }).filter(r => r.to !== 'FT01_Live' || world.nodes.FT01_Mobile_Root); // FT01 only once the designer ships it
  return [...sources, ...returns];
}

function bake(route, data, row) {
  const curve = new THREE.CatmullRomCurve3(route.points, false, 'centripetal'), v = new THREE.Vector3();
  for (let i = 0; i < SAMPLES; i++) { curve.getPointAt(i / (SAMPLES - 1), v); data.set([v.x, v.y, v.z, 1], (row * SAMPLES + i) * 4); }
  route.length = curve.getLength();
  // u of the point closest to the user anchor (where the streams pinch and where returns settle).
  let best = 1e9;
  for (let i = 0; i < SAMPLES; i += 2) { curve.getPointAt(i / (SAMPLES - 1), v); const d = v.distanceToSquared(route.mark); if (d < best) { best = d; route.uMark = i / (SAMPLES - 1); } }
}

export function SignalStreams() {
  const world = useWorld(), gl = useThree(s => s.gl), S = C.streams;
  const size = useThree(s => s.size);
  const { routes, geometry, material, line, texture, map } = useMemo(() => {
    const routes = buildRoutes(world).slice(0, MAX_ROUTES), rows = routes.length;
    const data = new Float32Array(SAMPLES * rows * 4);
    routes.forEach((r, i) => bake(r, data, i));
    const texture = new THREE.DataTexture(data, SAMPLES, rows, THREE.RGBAFormat, THREE.FloatType);
    texture.needsUpdate = true;
    const random = rng(7), gauss = () => Math.sqrt(-2 * Math.log(1 - random())) * Math.cos(6.2832 * random());
    const path = [], misc = [], tone = [], wisp = [];
    routes.forEach((r, i) => {
      const n = Math.round(r.length * S.density);
      for (let k = 0; k < n; k++) {
        const kind = random(), speed = (S.speed[0] + random() * (S.speed[1] - S.speed[0])) / r.length;
        // Mix around the light lines: sparks hugging the strands, a looser body, fine smoky wisps and a few strays.
        const [spread, size, alpha, isWisp] = kind < .45 ? [.14, .03 + random() * .02, 1, 0] : kind < .82 ? [.32, .035 + random() * .03, .75, 0]
          : kind < .9 ? [.4, .08 + random() * .06, .28, 1] : [.9, .035 + random() * .03, .5, 0];
        wisp.push(isWisp);
        path.push(i, random(), speed, random());
        misc.push(gauss() * spread, gauss() * spread, size, alpha);
        tone.push(random() ** 1.6);
      }
    });
    const geometry = new THREE.BufferGeometry(), count = tone.length;
    geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(count * 3), 3));
    geometry.setAttribute('aPath', new THREE.Float32BufferAttribute(path, 4));
    geometry.setAttribute('aMisc', new THREE.Float32BufferAttribute(misc, 4));
    geometry.setAttribute('aTone', new THREE.Float32BufferAttribute(tone, 1));
    geometry.setAttribute('aWisp', new THREE.Float32BufferAttribute(wisp, 1));
    const map = new THREE.TextureLoader().load('/particle.png');
    const color = c => new THREE.Color(c), pad = f => Array.from({ length:MAX_ROUTES }, (_, i) => f(i));
    const material = new THREE.ShaderMaterial({
      vertexShader, fragmentShader, transparent:true, depthWrite:false,
      // Additive colour; destination alpha untouched (alpha marks the logo face in the energy pass).
      blending:THREE.CustomBlending, blendSrc:THREE.OneFactor, blendDst:THREE.OneFactor, blendSrcAlpha:THREE.ZeroFactor, blendDstAlpha:THREE.OneFactor,
      uniforms:{ map:{ value:map }, paths:{ value:texture }, rows:{ value:rows }, time:{ value:0 }, scale:{ value:1 }, intensity:{ value:S.intensity },
        state:{ value:pad(() => new THREE.Vector4()) }, info:{ value:pad(i => routes[i] ? new THREE.Vector4(routes[i].length, routes[i].uMark, S.width * (routes[i].width || 1), 0) : new THREE.Vector4()) },
        deep:{ value:color(S.color) }, bright:{ value:color(S.bright) }, sparkle:{ value:color(S.sparkle) } },
    });
    // The lines share the particles' uniforms (same routes, windows and sway).
    const line = new THREE.Mesh(lineGeometry(routes, S.line.strands), new THREE.ShaderMaterial({
      vertexShader:lineVertex, fragmentShader:lineFragment, transparent:true, depthWrite:false, side:THREE.DoubleSide,
      blending:THREE.CustomBlending, blendSrc:THREE.OneFactor, blendDst:THREE.OneFactor, blendSrcAlpha:THREE.ZeroFactor, blendDstAlpha:THREE.OneFactor,
      uniforms:{ ...material.uniforms, res:{ value:new THREE.Vector2(1, 1) }, px:{ value:1 }, lineWidth:{ value:S.line.width }, lineBright:{ value:S.line.brightness } },
    }));
    line.frustumCulled = false; line.userData.energy = true;
    window.__streams = { routes:routes.length, particles:count };
    return { routes, geometry, material, line, texture, map };
  }, [world, S]);
  useEffect(() => () => { geometry.dispose(); material.dispose(); line.geometry.dispose(); line.material.dispose(); texture.dispose(); map.dispose(); }, [geometry, material, line, texture, map]);
  useEffect(() => { line.material.uniforms.px.value = gl.getPixelRatio(); gl.getDrawingBufferSize(line.material.uniforms.res.value); }, [line, gl, size]);

  useFrame(({ clock, camera, size }) => {
    const s = story.s, T = C.timeline, u = material.uniforms;
    u.time.value = clock.elapsedTime;
    u.scale.value = size.height * gl.getPixelRatio() / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2));
    routes.forEach((r, i) => {
      const st = u.state.value[i];
      if (r.kind === 'source') {
        const start = T.signals.start + r.index * T.signals.stagger, arrive = start + T.signals.travel;
        const grow = ease(ramp(s, [start, arrive])), rise = ease(ramp(s, [arrive, arrive + .35]));
        st.set(r.uMark * grow + (1 - r.uMark) * rise, ease(ramp(s, [T.drain[0] + r.index * .02, T.drain[1]])), r.width ? .8 : 1, 0);
      } else {
        const start = T.returns.start + r.index * T.returns.stagger;
        // Returns quieten in Live Pulse so the labels stay readable.
        st.set(1 - (1 - ramp(s, [start, start + T.returns.travel])) ** 2, r.uMark * ease(ramp(s, T.settle)), 1 - .3 * ramp(s, [4.3, 4.8]), 0);
        if (r.dynamic && st.x > 0) {
          const end = r.end();
          if (!r.last || r.last.distanceToSquared(end) > 1e-4) {
            r.last = end; r.points = [...r.head, end];
            bake(r, texture.image.data, i); u.info.value[i].setX(r.length).setY(r.uMark); texture.needsUpdate = true;
          }
        }
      }
    });
  });
  return <>
    <primitive object={line} />
    <points geometry={geometry} material={material} frustumCulled={false} userData={{ energy:true }} />
  </>;
}
