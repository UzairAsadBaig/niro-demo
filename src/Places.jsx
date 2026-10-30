import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { Html } from '@react-three/drei';
import * as THREE from 'three';
import { SCENE_CONFIG as C } from './scene-config';
import { story, ramp, ease, activation, useWorld, ft01At, ft01Live } from './story';

// Opportunity places: the designer's props stay dark and desaturated until their return stream arrives, then come
// back to full colour with their emission (shop interiors, truck windows, signs) boosted. Plus Aqua opportunity markers
// and the projected Live Pulse labels. Dormancy works by world position (each place's `zones`), so it doesn't depend
// on how the GLB merges or names meshes.
const MAX_ZONES = 12;
function dormancy(scene, places) {
  const D = C.dormant, list = places.flatMap(p => p.zones.map(z => ({ z, p })));
  const uniforms = {
    uZones:{ value:Array.from({ length:MAX_ZONES }, (_, i) => list[i] ? new THREE.Vector4(...list[i].z, 0) : new THREE.Vector4(0, 0, -1, 0)) },
    // Optional coloured light wash per zone (e.g. the stage), as rgb × intensity.
    uWash:{ value:Array.from({ length:MAX_ZONES }, (_, i) => list[i]?.p.wash ? new THREE.Color(list[i].p.wash[0]).multiplyScalar(list[i].p.wash[1]) : new THREE.Color(0)) },
    uDark:{ value:D.brightness }, uSat:{ value:D.saturation }, uLampOff:{ value:D.emission }, uGlow:{ value:D.glow },
  };
  uniforms.owner = list.map(({ p }) => p.id); // zone index → place id (not a shader uniform)
  const patched = new Set();
  scene.traverse(o => {
    if (!o.isMesh || ![o.material].flat().some(m => D.materials.test(m.name))) return;
    for (const m of [o.material].flat()) if (D.materials.test(m.name) && !patched.has(m)) { patched.add(m); patch(m, uniforms); }
    // Only meshes that actually emit feed the bloom, so bright lit props (white planters, truck bodies) don't glow.
    if ([o.material].flat().some(m => m.emissiveMap || m.emissive?.getHex())) o.userData.bloom = true;
  });
  return uniforms;
}
function patch(material, uniforms) {
  material.onBeforeCompile = shader => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>\nvarying vec2 vZoneXZ;')
      .replace('#include <project_vertex>', '#include <project_vertex>\nvZoneXZ=(modelMatrix*vec4(transformed,1.)).xz;');
    shader.fragmentShader = shader.fragmentShader.replace('#include <common>', `#include <common>
varying vec2 vZoneXZ;uniform vec4 uZones[${MAX_ZONES}];uniform vec3 uWash[${MAX_ZONES}];uniform float uDark,uSat,uLampOff,uGlow;`)
      .replace('#include <map_fragment>', `#include <map_fragment>
 float zone=0.,zact=0.;vec3 wash=vec3(0.);
 for(int i=0;i<${MAX_ZONES};i++){vec4 z=uZones[i];if(z.z<=0.)continue;float w=1.-smoothstep(z.z*.85,z.z,distance(vZoneXZ,z.xy));zone=max(zone,w);zact=max(zact,w*z.w);wash+=uWash[i]*w*z.w;}
 float sleep=max(zone-zact,0.);
 vec3 zAlbedo=diffuseColor.rgb;float zl=dot(zAlbedo,vec3(.2126,.7152,.0722));
 diffuseColor.rgb=mix(zAlbedo,mix(vec3(zl),zAlbedo,uSat),sleep);`)
      // The designer's emission maps: off in a dormant place, boosted once it is active.
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
 totalEmissiveRadiance*=(1.-sleep*(1.-uLampOff))*mix(1.,uGlow,zact);
 totalEmissiveRadiance+=zAlbedo*wash;`)
      // Dormant places also lose their reflections and lighting, so they read as dark silhouettes.
      .replace('#include <opaque_fragment>', 'outgoingLight*=mix(1.,uDark,sleep);\n#include <opaque_fragment>');
  };
  material.customProgramCacheKey = () => 'niro-dormant';
  material.needsUpdate = true;
}

const markerVertex = `uniform float scale;attribute float size,alpha,kind;varying float vAlpha,vKind;
void main(){vec4 mv=modelViewMatrix*vec4(position,1.);gl_Position=projectionMatrix*mv;gl_PointSize=size*scale/-mv.z;vAlpha=alpha;vKind=kind;}`;
const markerFragment = `uniform vec3 color;varying float vAlpha,vKind;
void main(){float d=length(gl_PointCoord-.5)*2.;if(d>1.)discard;
 float dotA=exp(-d*d*9.)+exp(-d*d*60.)*1.5,ringA=exp(-pow((d-.78)/.07,2.))*(1.-smoothstep(.9,1.,d));
 gl_FragColor=vec4(color*vAlpha*mix(dotA,ringA,vKind),0.);}`;
const poolMaterial = () => new THREE.ShaderMaterial({
  transparent:true, depthWrite:false, blending:THREE.AdditiveBlending, polygonOffset:true, polygonOffsetFactor:-2, polygonOffsetUnits:-2,
  vertexShader:`varying vec2 vUv;varying vec3 vColor;void main(){vUv=uv;vColor=instanceColor;gl_Position=projectionMatrix*modelViewMatrix*instanceMatrix*vec4(position,1.);}`,
  fragmentShader:`varying vec2 vUv;varying vec3 vColor;void main(){float r=length(vUv-.5)*2.;gl_FragColor=vec4(vColor*exp(-r*r*3.5)*(1.-smoothstep(.75,1.,r)),1.);}`,
});

export function Places() {
  const world = useWorld(), L = C.lighting;
  const labels = useRef([]), lights = useRef([]), glowRefs = useRef([]);
  const built = useMemo(() => {
    const ray = new THREE.Raycaster(), down = new THREE.Vector3(0, -1, 0);
    const ground = (x, z) => { ray.set(new THREE.Vector3(x, 2.4, z), down); return ray.intersectObject(world.scene, true)[0]?.point.y ?? 0; };
    const places = C.places.map(p => {
      const anchor = world.anchors[p.id];
      const frame = new THREE.Matrix4().compose(new THREE.Vector3(anchor.x, ground(anchor.x, anchor.z), anchor.z), new THREE.Quaternion().setFromAxisAngle(THREE.Object3D.DEFAULT_UP, p.facing), new THREE.Vector3(1, 1, 1));
      const local = (x, y, z) => new THREE.Vector3(x, y, z).applyMatrix4(frame);
      const front = p.lamp || (p.kind === 'event' ? [0, 3.2, 1.6] : p.kind === 'trucks' ? [0, 3.2, 0] : [0, 2.2, 1.7]);
      const pool = p.pool || (p.kind === 'event' ? [0, 1.4, 4] : p.kind === 'trucks' ? [0, 0, 6] : [0, 2.2, 3.2]);
      return { ...p, anchor, lightAt:local(...front), pool:{ position:local(pool[0], .02, pool[1]), radius:pool[2] }, color:new THREE.Color(p.light) };
    });
    // FT01 (the moving truck) only exists once the GLB ships FT01_Mobile_Root; until then it has no marker, light or route.
    const glbTruck = world.nodes.FT01_Mobile_Root;
    const zones = dormancy(world.scene, places);
    const windows = new Set();
    world.scene.traverse(o => { if (o.isMesh) for (const m of [o.material].flat()) if (C.windows.materials.test(m.name)) windows.add(m); });
    const characters = new Set();
    world.scene.traverse(o => { if (o.isMesh) for (const m of [o.material].flat()) if (C.characters.materials.test(m.name)) characters.add(m); });
    // Hanging string lights share the lamp material, so each gets its own copy to fade with its place.
    const strings = [];
    for (const p of places) if (p.hanging) world.scene.traverse(o => {
      if (!o.isMesh || o.material.name !== 'Emission' || !p.hanging.test(o.parent.name)) return; // multi-material GLB nodes load as a group of meshes
      o.material = o.material.clone(); o.material.emissive.set(L.lampColor);
      strings.push({ material:o.material, place:p.id });
    });
    // Inner glow: a warm light inside each matching designer node or material (the stage, truck tubes), on with activation.
    const glows = [];
    for (const p of places) if (p.glow) world.scene.traverse(o => {
      if (!(p.glow.nodes?.test(o.name) || (o.isMesh && [o.material].flat().some(m => p.glow.material?.test(m.name))))) return;
      const b = new THREE.Box3().setFromObject(o);
      glows.push({ ...p.glow, place:p.id, position:b.getCenter(new THREE.Vector3()).setY(b.min.y + p.glow.height) });
    });
    // Ground light pools and markers: one instanced draw and one point draw for all places (+ FT01 live).
    const markerCount = places.length + (glbTruck ? 1 : 0), mg = new THREE.BufferGeometry();
    mg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(markerCount * 2 * 3), 3));
    for (const name of ['size', 'alpha', 'kind']) mg.setAttribute(name, new THREE.BufferAttribute(new Float32Array(markerCount * 2), 1));
    for (let i = 0; i < markerCount; i++) mg.attributes.kind.setX(i * 2 + 1, 1);
    const markerMaterial = new THREE.ShaderMaterial({ vertexShader:markerVertex, fragmentShader:markerFragment, transparent:true, depthWrite:false,
      blending:THREE.CustomBlending, blendSrc:THREE.OneFactor, blendDst:THREE.OneFactor, blendSrcAlpha:THREE.ZeroFactor, blendDstAlpha:THREE.OneFactor,
      uniforms:{ color:{ value:new THREE.Color(C.aqua).multiplyScalar(3) }, scale:{ value:1 } } });
    return { places, glbTruck, zones, glows, strings, windows, characters, markerCount, markerGeometry:mg, markerMaterial, pools:poolMaterial() };
  }, [world]);
  useEffect(() => () => { built.markerGeometry.dispose(); built.markerMaterial.dispose(); built.pools.dispose(); }, [built]);

  const pools = useRef(), m4 = useMemo(() => new THREE.Matrix4(), []), q = useMemo(() => new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.PI / 2, 0, 0)), []);
  const tmp = useMemo(() => ({ color:new THREE.Color(), scale:new THREE.Vector3() }), []), tmpColor = tmp.color;
  useFrame(({ clock, camera, size, gl }) => {
    const s = story.s, time = clock.elapsedTime, { places, glbTruck, markerGeometry: mg } = built;
    const act = Object.fromEntries(places.map(p => [p.id, activation(p.id, s)]));
    act.FT01_Live = glbTruck ? activation('FT01_Live', s) : 0;
    // Designer props: dormant → active, per zone.
    built.zones.owner.forEach((id, i) => { built.zones.uZones.value[i].w = act[id]; });
    places.forEach((p, i) => { if (lights.current[i]) lights.current[i].intensity = L.placeLight * act[p.id]; });
    built.glows.forEach((g, i) => { if (glowRefs.current[i]) glowRefs.current[i].intensity = g.intensity * act[g.place]; });
    const W = C.windows, warm = W.dim + (1 - W.dim) * ease(ramp(s, W.ramp));
    built.windows.forEach(m => { m.emissiveIntensity = C.emission[m.name] * warm; });
    const K = C.characters, lum = K.dim + (1 - K.dim) * ease(ramp(s, K.ramp));
    built.characters.forEach(m => m.color.setScalar(lum));
    built.strings.forEach(h => { h.material.emissiveIntensity = C.emission.Emission * act[h.place]; });
    // FT01 drives along its path.
    const drive = ft01At(s, world), live = ft01Live(s, world);
    if (glbTruck) { glbTruck.position.copy(drive.position); glbTruck.rotation.y = drive.heading; }
    if (lights.current[places.length]) { lights.current[places.length].position.copy(live).y -= 1.2; lights.current[places.length].intensity = L.placeLight * .6 * act.FT01_Live; }
    // Ground pools.
    places.forEach((p, i) => {
      m4.compose(p.pool.position, q, tmp.scale.set(p.pool.radius * 2, p.pool.radius * 2, 1));
      pools.current.setMatrixAt(i, m4); pools.current.setColorAt(i, tmpColor.copy(p.color).multiplyScalar(.22 * act[p.id]));
    });
    m4.compose(drive.position.clone().setY(drive.position.y + .03), q, tmp.scale.set(5, 5, 1));
    pools.current.setMatrixAt(places.length, m4); pools.current.setColorAt(places.length, tmpColor.set('#ffb86b').multiplyScalar(.16 * act.FT01_Live));
    pools.current.instanceMatrix.needsUpdate = true; pools.current.instanceColor.needsUpdate = true;
    // Opportunity markers (P15): pop in on arrival with a ring burst, then a slow live pulse.
    const markers = [...places.map(p => [p.anchor, act[p.id]]), [live, act.FT01_Live]].slice(0, built.markerCount);
    markers.forEach(([at, a], i) => {
      const pulse = (time * .45 + i * .23) % 1, burst = ramp(a, [0, 1]);
      mg.attributes.position.setXYZ(i * 2, at.x, at.y, at.z); mg.attributes.position.setXYZ(i * 2 + 1, at.x, at.y, at.z);
      mg.attributes.size.setX(i * 2, .55 * Math.min(1.25, a * 1.6)); mg.attributes.alpha.setX(i * 2, a);
      const ring = burst < 1 ? burst : pulse;
      mg.attributes.size.setX(i * 2 + 1, .6 + ring * 1.6); mg.attributes.alpha.setX(i * 2 + 1, a * (1 - ring) * (burst < 1 ? 1.2 : .55));
    });
    for (const name of ['position', 'size', 'alpha']) mg.attributes[name].needsUpdate = true;
    built.markerMaterial.uniforms.scale.value = size.height * gl.getPixelRatio() / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2));
    // Live Pulse labels: only three at once, staggered in after the destinations are active.
    let k = 0;
    places.forEach((p, i) => {
      const el = labels.current[i];
      if (!el) return;
      const start = C.timeline.labels.start + k++ * C.timeline.labels.stagger, o = ease(ramp(s, [start, start + C.timeline.labels.fade]));
      el.style.opacity = o; el.style.visibility = o > 0 ? 'visible' : 'hidden'; el.style.setProperty('--rise', `${(1 - o) * 10}px`);
    });
  });

  const { places, glbTruck } = built, narrow = innerWidth < 700; // narrow screens: boxes sit straight above their markers
  return <group>
    {places.map((p, i) => <pointLight key={p.id} ref={o => { lights.current[i] = o; }} position={p.lightAt} color={p.color} intensity={0} distance={11} decay={2} />)}
    {built.glows.map((g, i) => <pointLight key={'glow' + i} ref={o => { glowRefs.current[i] = o; }} position={g.position} color={g.color} intensity={0} distance={g.distance} decay={2} />)}
    {glbTruck && <pointLight ref={o => { lights.current[places.length] = o; }} color="#ffb86b" intensity={0} distance={8} decay={2} />}
    {places.filter(p => p.label).map(p => <Html key={p.id} position={p.anchor} zIndexRange={[20, 0]} pointerEvents="none">
      <div className="pulse-label" ref={o => { labels.current[places.indexOf(p)] = o; }} style={{ '--dx':`${narrow ? 0 : p.labelSide * 34}px`, '--lift':`${narrow ? p.narrowLift || 0 : 0}px` }}>
        <svg width="1" height="1"><line x1="0" y1="0" x2={narrow ? 0 : p.labelSide * 34} y2={-58 - (narrow ? p.narrowLift || 0 : 0)} /></svg>
        <span>{p.label}</span>
      </div>
    </Html>)}
    <instancedMesh ref={pools} args={[null, null, places.length + 1]} material={built.pools} frustumCulled={false} userData={{ lightPool:true }}><planeGeometry args={[1, 1]} /></instancedMesh>
    <points geometry={built.markerGeometry} material={built.markerMaterial} frustumCulled={false} userData={{ energy:true }} />
    <UserMarker position={world.anchors.User} />
  </group>;
}

// User pulse (P14): two Aqua rings, centre point and beam, with a slow ripple outward.
function UserMarker({ position }) {
  const m = C.marker, ripple = useRef();
  useFrame(({ clock }) => {
    const t = (clock.elapsedTime * .35) % 1;
    ripple.current.scale.setScalar(1 + t * 2.4); ripple.current.material.opacity = (1 - t) ** 2 * .8;
  });
  return <group position={position}>
    {[m.radius, m.radius * 1.65].map((r, i) => <mesh userData={{ bloom:true }} key={r} rotation={[-Math.PI / 2, 0, 0]} position={[0, i * .005, 0]}><ringGeometry args={[r - .025, r + .025, 80]} /><meshBasicMaterial color={m.color} toneMapped={false} /></mesh>)}
    <mesh ref={ripple} userData={{ bloom:true }} rotation={[-Math.PI / 2, 0, 0]} position={[0, .008, 0]}><ringGeometry args={[m.radius - .02, m.radius + .02, 80]} /><meshBasicMaterial color={m.color} transparent depthWrite={false} toneMapped={false} /></mesh>
    <mesh userData={{ bloom:true }} rotation={[-Math.PI / 2, 0, 0]} position={[0, .012, 0]}><circleGeometry args={[.23, 32]} /><meshBasicMaterial color={m.color} toneMapped={false} /></mesh>
    <mesh userData={{ bloom:true }} position={[0, m.beamHeight / 2, 0]}><cylinderGeometry args={[.025, .045, m.beamHeight, 12]} /><meshBasicMaterial color={m.color} transparent opacity={.7} toneMapped={false} /></mesh>
  </group>;
}
