import React, { Component, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { useGLTF, useProgress } from '@react-three/drei';
import * as THREE from 'three';
import Lenis from 'lenis';
import 'lenis/dist/lenis.css';
import './style.css';
import { SCENE_CONFIG } from './scene-config';
import { Atmosphere, CityEnvironment } from './Atmosphere.jsx';
import { NiroLogo } from './NiroLogo.jsx';
import { SignalStreams } from './SignalStreams.jsx';
import { Places } from './Places.jsx';
import { MODEL, STAGES, story, clamp01 } from './story';

const DEV = new URLSearchParams(location.search).has('dev');
const KEYS = SCENE_CONFIG.camera.keys;

class SceneBoundary extends Component {
  state = { error: null };
  static getDerivedStateFromError(error) { return { error }; }
  componentDidCatch(error) { window.__cityError = error.message; }
  render() {
    if (this.state.error) return <div className="error-panel"><h2>The scene couldn’t load</h2><p>{this.state.error.message}</p><button onClick={() => location.reload()}>Try again</button></div>;
    return this.props.children;
  }
}

function City({ onReady, wireframe }) {
  const { scene } = useGLTF(MODEL);
  const { gl, invalidate } = useThree();
  const prepared = useMemo(() => {
    const materials = new Set();
    let meshes = 0, triangles = 0;
    scene.traverse((object) => {
      if (!object.isMesh) return;
      meshes++;
      triangles += (object.geometry.index?.count ?? object.geometry.attributes.position.count) / 3 * (object.isInstancedMesh ? object.count : 1);
      materials.add(object.material);
      for (const m of [object.material].flat()) {
        // Emission strength per designer material (scene-config `emission`); lamps get the warm lamp colour.
        if (m.name in SCENE_CONFIG.emission) m.emissiveIntensity = SCENE_CONFIG.emission[m.name];
        if (m.name in SCENE_CONFIG.emissionColor) m.emissive.set(SCENE_CONFIG.emissionColor[m.name]);
        if (m.name === 'Emission') { m.emissive.set(SCENE_CONFIG.lighting.lampColor); object.userData.bloom = true; }
      }
      object.castShadow = object.name !== 'Roads_and_paving';
      object.receiveShadow = true;
      object.updateMatrix();
      object.matrixAutoUpdate = false;
      for (const key of ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'emissiveMap']) {
        if (object.material[key]) {
          const texture = object.material[key];
          texture.anisotropy = Math.min(8, gl.capabilities.getMaxAnisotropy());
          // Do not let atlas mip levels mix foliage with the adjacent emissive tiles.
          if (object.material.name.startsWith('CITY')) {
            texture.minFilter = THREE.LinearFilter;
            texture.generateMipmaps = false;
            texture.needsUpdate = true;
          }
        }
      }
    });
    return { meshes, triangles, materials: materials.size };
  }, [scene, gl]);
  useEffect(() => { onReady(prepared); window.__cityAsset = prepared; }, [onReady, prepared]);
  useEffect(() => {
    scene.traverse(o => { if (o.isMesh) o.material.wireframe = wireframe; });
    invalidate();
  }, [scene, wireframe, invalidate]);
  return <primitive object={scene} dispose={null} />;
}

// Story time → curve parameter: a monotone cubic (Fritsch–Carlson) through the key times, so the camera passes
// each key with its momentum instead of easing to a stop there.
function keyParam(s) {
  const t = KEYS.map(k => k.s), n = t.length;
  if (s <= t[0]) return 0;
  if (s >= t[n - 1]) return 1;
  let i = 0;
  while (s > t[i + 1]) i++;
  const h = t[i + 1] - t[i], x = (s - t[i]) / h;
  const slope = j => j === 0 ? 1 / (t[1] - t[0]) : j === n - 1 ? 1 / (t[n - 1] - t[n - 2]) : 2 / (t[j + 1] - t[j - 1]);
  const m0 = Math.min(slope(i), 3 / h), m1 = Math.min(slope(i + 1), 3 / h);
  return (i + (3 - 2 * x) * x * x + (x * x * x - 2 * x * x + x) * h * m0 + (x * x * x - x * x) * h * m1) / (n - 1);
}

// One camera rig on the scroll timeline: position, target, FOV and mobile pull-back all follow Catmull-Rom curves
// through the keys; portrait screens pull back along the view line, and the cursor adds a little parallax.
const UP = new THREE.Vector3(0, 1, 0);
function CameraRig({ onCamera }) {
  const { camera } = useThree();
  const pointer = useRef([0, 0]), sway = useRef([0, 0]), lastReport = useRef(0);
  const rig = useMemo(() => ({
    position: new THREE.CatmullRomCurve3(KEYS.map(k => new THREE.Vector3(...k.position)), false, 'centripetal'),
    target: new THREE.CatmullRomCurve3(KEYS.map(k => new THREE.Vector3(...k.target)), false, 'centripetal'),
    mobileTarget: new THREE.CatmullRomCurve3(KEYS.map(k => new THREE.Vector3(...(k.mobileTarget || k.target))), false, 'centripetal'),
    // x = FOV, y = mobile pull-back distance.
    lens: new THREE.CatmullRomCurve3(KEYS.map(k => new THREE.Vector3(k.fov, k.mobileDistance || SCENE_CONFIG.camera.mobile.distance, 0))),
    optics: new THREE.Vector3(),
    base: new THREE.Vector3(), aim: new THREE.Vector3(), view: new THREE.Vector3(), stageOne: new THREE.Vector3(...KEYS[1].position).distanceTo(new THREE.Vector3(...KEYS[1].target)),
  }), []);
  useEffect(() => {
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const move = e => { pointer.current = [e.clientX / innerWidth * 2 - 1, 1 - e.clientY / innerHeight * 2]; }, leave = () => { pointer.current = [0, 0]; };
    window.addEventListener('pointermove', move); document.addEventListener('mouseleave', leave);
    return () => { window.removeEventListener('pointermove', move); document.removeEventListener('mouseleave', leave); };
  }, []);
  useFrame((state, delta) => {
    const s = story.s, param = keyParam(s);
    rig.position.getPoint(param, rig.base); rig.target.getPoint(param, rig.aim); rig.lens.getPoint(param, rig.optics);
    let fov = rig.optics.x;
    if (camera.aspect < 1) {
      const view = rig.view.subVectors(rig.base, rig.aim).multiplyScalar(rig.optics.y);
      rig.mobileTarget.getPoint(param, rig.aim); rig.base.copy(rig.aim).add(view); fov += SCENE_CONFIG.camera.mobile.fov;
    }
    const P = SCENE_CONFIG.parallax, sw = sway.current, p = pointer.current, k = 1 - Math.exp(-delta * P.ease);
    sw[0] += (p[0] - sw[0]) * k; sw[1] += (p[1] - sw[1]) * k;
    const forward = rig.aim.clone().sub(rig.base), scale = forward.length() / rig.stageOne;
    const right = forward.clone().cross(UP).normalize(), up = right.clone().cross(forward).normalize();
    camera.position.copy(rig.base).addScaledVector(right, sw[0] * P.x * scale).addScaledVector(up, sw[1] * P.y * scale);
    camera.lookAt(rig.aim);
    if (camera.fov !== fov) { camera.fov = fov; camera.updateProjectionMatrix(); }
    (camera.userData.target ||= new THREE.Vector3()).copy(rig.aim);
    if (state.clock.elapsedTime - lastReport.current > .15) {
      const data = { s:+s.toFixed(3), position:camera.position.toArray().map(n => +n.toFixed(2)), lookAt:rig.aim.toArray().map(n => +n.toFixed(2)), fov:+fov.toFixed(1) };
      window.__cityCamera = data; onCamera(data); lastReport.current = state.clock.elapsedTime;
    }
  });
  return null;
}

function Lighting({ exposure, shadows, mode }) {
  const { gl, scene, invalidate } = useThree();
  const day = mode === 'day';
  useEffect(() => {
    gl.toneMappingExposure = exposure;
    gl.shadowMap.enabled = shadows;
    gl.shadowMap.needsUpdate = true;
    scene.traverse(o => { if (o.isMesh) o.material.needsUpdate = true; });
    invalidate();
  }, [gl, scene, exposure, shadows, invalidate]);
  return <>
    <color attach="background" args={[day ? '#8a9aa8' : '#0b1420']} />

    <hemisphereLight args={[day ? '#cbdfff' : '#7f8a9b', '#121418', day ? 2.4 : 1]} />
    <directionalLight position={[-30, 80, 30]} intensity={day ? 3.1 : 2.9} color={day ? '#fff1d8' : '#c3cedd'}
      castShadow={shadows} shadow-mapSize={[2048, 2048]} shadow-camera-left={-90} shadow-camera-right={90}
      shadow-camera-top={90} shadow-camera-bottom={-90} shadow-camera-near={1} shadow-camera-far={220}
      shadow-bias={-0.00015} shadow-normalBias={0.10} />

  </>;
}

function Metrics({ onStats }) {
  const { gl } = useThree();
  useEffect(() => {
    let last = '';
    const timer = setInterval(() => {
      const metrics = gl.__cityFrameMetrics || { calls: gl.info.render.calls, triangles: gl.info.render.triangles };
      window.__cityRuntime = metrics;
      const key = `${metrics.calls}:${metrics.triangles}`;
      if (last !== key) { last = key; onStats(metrics); }
    }, 500);
    return () => clearInterval(timer);
  }, [gl, onStats]);
  return null;
}

function Loading({ ready }) {
  const { progress, errors } = useProgress();
  if (ready) return null;
  return <div className="loading" role="status"><div className="loading-card"><span className="eyebrow">NIRO</span><h2>{errors.length ? 'Model unavailable' : 'Bringing the neighborhood to life'}</h2><div className="progress"><i style={{ width: `${Math.max(4, progress)}%` }} /></div><p>{errors.length ? 'Check that public/dark-city.glb exists, then reload.' : 'Loading the city…'}</p></div></div>;
}

function App() {
  const [ready, setReady] = useState(null);
  const [stats, setStats] = useState({ calls: 0, triangles: 0 });
  const [wireframe, setWireframe] = useState(false);
  const [shadows, setShadows] = useState(true);
  const [mode, setMode] = useState('night');
  const [exposure, setExposure] = useState(SCENE_CONFIG.lighting.exposure);
  const [fogStrength, setFogStrength] = useState(SCENE_CONFIG.atmosphere.strength);
  const [settings, setSettings] = useState(false);
  const [bloomEnabled,setBloomEnabled]=useState(true);
  const [logoBloom,setLogoBloom]=useState(SCENE_CONFIG.logo.bloom.intensity),[logoBloomRadius,setLogoBloomRadius]=useState(SCENE_CONFIG.logo.bloom.radius);
  const [debug,setDebug]=useState(false),[cameraData,setCameraData]=useState(null);
  const [chapter, setChapter] = useState(0), [covered, setCovered] = useState(false), [cue, setCue] = useState('start');
  const track = useRef(), landing = useRef(), fill = useRef(), lenis = useRef();
  const onCamera=useCallback(data=>setCameraData(data),[]);
  useEffect(()=>{const key=e=>{if(/INPUT|SELECT|TEXTAREA/.test(e.target.tagName)||e.ctrlKey||e.metaKey||e.altKey)return;
    if(e.key.toLowerCase()==='b')setBloomEnabled(v=>!v);
    if(e.key.toLowerCase()==='d')setDebug(v=>!v);
  };window.addEventListener('keydown',key);return()=>window.removeEventListener('keydown',key);},[]);
  // Scroll position → story time. Lenis smooths the scroll itself (wheel and touch), so story time follows it directly.
  // The track is STAGES × scrollPerStage viewports tall; the landing page follows it.
  useEffect(() => {
    if (!matchMedia('(prefers-reduced-motion: reduce)').matches) lenis.current = new Lenis({ autoRaf:true, lerp:SCENE_CONFIG.story.lerp });
    const update = () => {
      const max = track.current.offsetHeight - innerHeight, target = clamp01(scrollY / max) * STAGES;
      story.s = target;
      setChapter(Math.min(STAGES - 1, Math.floor(target)));
      setCue(target < .25 ? 'start' : target > STAGES - .45 && target < STAGES + .01 ? 'end' : '');
      fill.current?.style.setProperty('--progress', target / STAGES);
      setCovered(landing.current.getBoundingClientRect().top < -innerHeight * .5);
    };
    addEventListener('scroll', update, { passive:true }); addEventListener('resize', update); update();
    return () => { removeEventListener('scroll', update); removeEventListener('resize', update); lenis.current?.destroy(); };
  }, []);
  const scrollToTarget = target => lenis.current ? lenis.current.scrollTo(target, { duration:2.2 }) : (typeof target === 'number' ? scrollTo({ top:target }) : target.scrollIntoView());
  const goTo = i => scrollToTarget((i + .6) / STAGES * (track.current.offsetHeight - innerHeight));
  const onReady = useCallback(data => { setReady(data); window.__cityReady = true; }, []);
  const stages = SCENE_CONFIG.story.stages;
  return <main>
    <div className="stage">
      <SceneBoundary>
        <Canvas shadows frameloop={covered ? 'never' : 'always'} dpr={[1, 1.5]} camera={{ position: KEYS[0].position, fov: KEYS[0].fov, near: 0.5, far: 420 }}
          gl={{ antialias: true, powerPreference: 'high-performance', toneMapping: THREE.ACESFilmicToneMapping }}
          onCreated={({ gl }) => { gl.outputColorSpace = THREE.SRGBColorSpace; gl.shadowMap.type = THREE.PCFSoftShadowMap; gl.localClippingEnabled = true; }}
          fallback={<div className="error-panel"><h2>WebGL is unavailable</h2><p>Open this scene in a browser with hardware acceleration enabled.</p></div>}>
          <Lighting exposure={exposure} shadows={shadows} mode={mode} />
          <CityEnvironment />
          <Suspense fallback={null}>
            <City onReady={onReady} wireframe={wireframe} />
            <Places />
            <SignalStreams />
            <NiroLogo />
          </Suspense>
          <CameraRig onCamera={onCamera} />
          <Metrics onStats={setStats} />
          <Atmosphere strength={fogStrength} mode={mode} bloomEnabled={bloomEnabled} logoBloom={logoBloom} logoBloomRadius={logoBloomRadius} />
        </Canvas>
      </SceneBoundary>
      <header><span className="brand"><img src="/niro-mark-white.svg" alt="" /><span className="sr-only">NIRO</span></span></header>
      <section className="chapters" aria-live="polite">
        {stages.map((stage, i) => <article key={stage.title} className={i === chapter ? 'active' : ''} aria-hidden={i !== chapter}>
          <span className="eyebrow">{String(i + 1).padStart(2, '0')} / {stage.title}</span>
          <h1>{stage.title}<span>.</span></h1>
          <p>{stage.copy}</p>
        </article>)}
      </section>
      <nav className="rail" aria-label="Story chapters" ref={fill}>
        {stages.map((stage, i) => <button key={stage.title} aria-current={i === chapter ? 'step' : undefined} onClick={() => goTo(i)}><span>{String(i + 1).padStart(2, '0')}</span><b>{stage.title}</b></button>)}
      </nav>
      <button className={`cue ${cue ? 'show' : ''}`} tabIndex={cue ? 0 : -1} aria-hidden={!cue} onClick={() => cue === 'end' ? scrollToTarget(landing.current) : goTo(0)}>
        {cue === 'end' ? 'Continue into landing page' : 'Scroll to explore'}<i aria-hidden="true" />
      </button>
      {debug && <pre className="camera-debug" data-testid="camera-debug">{JSON.stringify(cameraData,null,2)}</pre>}
      {DEV && <aside className="tools"><button aria-expanded={settings} onClick={() => setSettings(s => !s)} className={settings ? 'active' : ''}>◐ <span>Scene settings</span></button>
        {settings && <div className="settings"><div className="setting-heading">SCENE SETTINGS</div><label>Light <select value={mode} onChange={e => setMode(e.target.value)}><option value="night">Blue hour</option><option value="day">Daylight</option></select></label><label className="range-label">Exposure <span>{exposure.toFixed(2)}</span><input aria-label="Exposure" type="range" min="0.5" max="2.5" step="0.05" value={exposure} onChange={e => setExposure(Number(e.target.value))} /></label><label className="range-label">Surrounding fog <span>{fogStrength.toFixed(2)}</span><input aria-label="Surrounding fog" type="range" min="0" max="2" step="0.05" value={fogStrength} onChange={e => setFogStrength(Number(e.target.value))} /></label><label>Soft shadows <input type="checkbox" checked={shadows} onChange={e => setShadows(e.target.checked)} /></label><label>Bloom (B)<input type="checkbox" checked={bloomEnabled} onChange={e=>setBloomEnabled(e.target.checked)}/></label><label className="range-label">Energy bloom <span>{logoBloom.toFixed(2)}</span><input aria-label="Energy bloom" type="range" min="0" max="1.5" step=".01" value={logoBloom} onChange={e=>setLogoBloom(+e.target.value)}/></label><label className="range-label">Energy bloom spread <span>{logoBloomRadius.toFixed(2)}</span><input aria-label="Energy bloom spread" type="range" min="0" max="1" step=".01" value={logoBloomRadius} onChange={e=>setLogoBloomRadius(+e.target.value)}/></label><label>Camera debug (D)<input type="checkbox" checked={debug} onChange={e=>setDebug(e.target.checked)}/></label><label>Wireframe <input type="checkbox" checked={wireframe} onChange={e => setWireframe(e.target.checked)} /></label><p>{ready ? `${ready.meshes} batches · ${Math.round(ready.triangles / 1000)}k triangles · ${stats.calls || '—'} main + FX draws` : 'Preparing scene'}</p></div>}
      </aside>}
      <Loading ready={ready} />
    </div>
    <div className="track" ref={track} style={{ height:`${(STAGES * SCENE_CONFIG.story.scrollPerStage + 1) * 100}vh` }} />
    {/* Placeholder for the landing page (Chirag); its background matches SCENE_CONFIG.landing so the 3D story blends in. */}
    <section className="landing" ref={landing} id="landing" style={{ '--landing':SCENE_CONFIG.landing }}>
      <span className="eyebrow">NIRO</span>
      <h2>Everything nearby, <span>in one app.</span></h2>
      <p>Discover businesses, services, events, and opportunities happening around you in real time.</p>
    </section>
  </main>;
}

createRoot(document.getElementById('root')).render(<App />);
