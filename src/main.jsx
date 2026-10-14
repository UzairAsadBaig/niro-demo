import React, { Component, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { OrbitControls, useGLTF, useProgress } from '@react-three/drei';
import * as THREE from 'three';
import './style.css';
import { SCENE_CONFIG } from './scene-config';
// Street lights were placed for the old city model; disabled until they're re-placed for the new one.
// import { StreetLighting } from './StreetLighting.jsx';
import { Atmosphere, CityEnvironment } from './Atmosphere.jsx';
import { NiroLogo } from './NiroLogo.jsx';

const MODEL = window.__CITY_MODEL_URL || '/dark-city.glb';
const VIEWS = SCENE_CONFIG.cameras;

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
      if(object.material.name.startsWith('FACADE'))object.material.emissiveIntensity=SCENE_CONFIG.lighting.windowEmission;
      if(object.material.name.startsWith('CITY'))object.material.emissiveIntensity=SCENE_CONFIG.lighting.propEmission;
      // Replace the broad baked lighting layer; preserve base color, normals and roughness.
      if(object.material.name.startsWith('GROUND'))object.material.emissiveIntensity=0;
      // New model: road-lamp heads. Warm them up and let the bloom pass pick them up.
      if(object.material.name==='Emission'){object.material.emissive.set(SCENE_CONFIG.lighting.lampColor);object.material.emissiveIntensity=SCENE_CONFIG.lighting.lampEmission;object.userData.bloom=true;}
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

const UP = new THREE.Vector3(0, 1, 0);
function CameraRig({ view, resetToken, autoRotate, onCamera }) {
  const controls = useRef(), pointer = useRef([0, 0]), sway = useRef([0, 0]);
  const { camera, invalidate } = useThree();
  const transition = useRef(null), lastReport = useRef(0);
  useEffect(() => {
    const preset=VIEWS[view];
    transition.current={from:camera.position.clone(),fromTarget:controls.current?.target.clone()||new THREE.Vector3(...preset.target),fromFov:camera.fov,elapsed:0,preset};
    invalidate();
  },[view,resetToken,camera,invalidate]);
  useEffect(()=>{
    if(!SCENE_CONFIG.lockCamera||matchMedia('(prefers-reduced-motion: reduce)').matches)return;
    const move=e=>{pointer.current=[e.clientX/innerWidth*2-1,1-e.clientY/innerHeight*2];invalidate();},leave=()=>{pointer.current=[0,0];invalidate();};
    window.addEventListener('pointermove',move);document.addEventListener('mouseleave',leave);
    return()=>{window.removeEventListener('pointermove',move);document.removeEventListener('mouseleave',leave);};
  },[invalidate]);
  useFrame((state,delta)=>{
    if(!controls.current)return;
    if(transition.current){
      const t=transition.current;t.elapsed+=delta;let x=Math.min(1,t.elapsed/t.preset.duration);
      const a=t.preset.easing==='cubicInOut'?(x<.5?4*x*x*x:1-Math.pow(-2*x+2,3)/2):x;
      camera.position.lerpVectors(t.from,new THREE.Vector3(...t.preset.position),a);
      controls.current.target.lerpVectors(t.fromTarget,new THREE.Vector3(...t.preset.target),a);
      camera.fov=THREE.MathUtils.lerp(t.fromFov,t.preset.fov,a);camera.updateProjectionMatrix();controls.current.update();
      if(x===1)transition.current=null;invalidate();
    }else if(SCENE_CONFIG.lockCamera){
      // Locked view: the camera follows the cursor a little while keeping its aim, so the city shifts the opposite way (parallax).
      const P=SCENE_CONFIG.parallax,s=sway.current,p=pointer.current,k=1-Math.exp(-delta*P.ease);
      s[0]+=(p[0]-s[0])*k;s[1]+=(p[1]-s[1])*k;
      const base=new THREE.Vector3(...VIEWS[view].position),target=controls.current.target,forward=target.clone().sub(base);
      const right=forward.clone().cross(UP).normalize(),up=right.clone().cross(forward).normalize();
      camera.position.copy(base).addScaledVector(right,s[0]*P.x).addScaledVector(up,s[1]*P.y);camera.lookAt(target);
      if(Math.abs(p[0]-s[0])+Math.abs(p[1]-s[1])>1e-4)invalidate();
    }
    if(autoRotate)invalidate();
    const marker=new THREE.Vector3(...SCENE_CONFIG.marker.position).project(camera);
    const data={position:camera.position.toArray().map(n=>+n.toFixed(3)),lookAt:controls.current.target.toArray().map(n=>+n.toFixed(3)),fov:+camera.fov.toFixed(2),markerScreen:[+(50+marker.x*50).toFixed(1),+(50-marker.y*50).toFixed(1)]};
    window.__cityCamera=data;
    if(state.clock.elapsedTime-lastReport.current>.15){onCamera(data);lastReport.current=state.clock.elapsedTime;}
  });
  return <OrbitControls ref={controls} makeDefault enabled={!SCENE_CONFIG.lockCamera} target={VIEWS[SCENE_CONFIG.startView].target} minDistance={8} maxDistance={300} minPolarAngle={.08} maxPolarAngle={Math.PI/2-.035} enableDamping dampingFactor={.07} autoRotate={autoRotate} autoRotateSpeed={.25} onStart={()=>{transition.current=null;}} />;
}
function UserMarker(){
 const m=SCENE_CONFIG.marker;
 return <group position={m.position}>
  {[m.radius,m.radius*1.65].map((r,i)=><mesh userData={{ bloom: true }} key={r} rotation={[-Math.PI/2,0,0]} position={[0,i*.005,0]}><ringGeometry args={[r-.025,r+.025,80]}/><meshBasicMaterial color={m.color} toneMapped={false}/></mesh>)}
  <mesh userData={{ bloom: true }} rotation={[-Math.PI/2,0,0]} position={[0,.012,0]}><circleGeometry args={[.23,32]}/><meshBasicMaterial color={m.color} toneMapped={false}/></mesh>
  <mesh userData={{ bloom: true }} position={[0,m.beamHeight/2,0]}><cylinderGeometry args={[.025,.045,m.beamHeight,12]}/><meshBasicMaterial color={m.color} transparent opacity={.7} toneMapped={false}/></mesh>
 </group>;
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
  return <div className="loading" role="status"><div className="loading-card"><span className="eyebrow">ENTERING THE CITY</span><h2>{errors.length ? 'Model unavailable' : 'Bringing the neighborhood to life'}</h2><div className="progress"><i style={{ width: `${Math.max(4, progress)}%` }} /></div><p>{errors.length ? 'Check that public/dark-city.glb exists, then reload.' : 'Loading geometry and embedded textures…'}</p></div></div>;
}

function App() {
  const [view, setView] = useState(SCENE_CONFIG.startView);
  const [ready, setReady] = useState(null);
  const [stats, setStats] = useState({ calls: 0, triangles: 0 });
  const [autoRotate, setAutoRotate] = useState(false);
  const [wireframe, setWireframe] = useState(false);
  const [shadows, setShadows] = useState(true);
  const [mode, setMode] = useState('night');
  const [exposure, setExposure] = useState(SCENE_CONFIG.lighting.exposure);
  const [fogStrength, setFogStrength] = useState(SCENE_CONFIG.atmosphere.strength);
  const [resetToken, setResetToken] = useState(0);
  const [settings, setSettings] = useState(false);
  const [bloomEnabled,setBloomEnabled]=useState(true);
  const [logoBloom,setLogoBloom]=useState(SCENE_CONFIG.logo.bloom.intensity),[logoBloomRadius,setLogoBloomRadius]=useState(SCENE_CONFIG.logo.bloom.radius);
  const [debug,setDebug]=useState(false),[cameraData,setCameraData]=useState(null);
  const onCamera=useCallback(data=>setCameraData(data),[]);
  useEffect(()=>{const key=e=>{if(/INPUT|SELECT|TEXTAREA/.test(e.target.tagName)||e.ctrlKey||e.metaKey||e.altKey)return;
    if(e.key==='4'){setView('concept');setResetToken(n=>n+1);}
    if(e.key.toLowerCase()==='b')setBloomEnabled(v=>!v);
    if(e.key.toLowerCase()==='d')setDebug(v=>!v);
  };window.addEventListener('keydown',key);return()=>window.removeEventListener('keydown',key);},[]);
  const onReady = useCallback(data => { setReady(data); window.__cityReady = true; }, []);
  return <main>
    <SceneBoundary>
      <Canvas shadows frameloop="demand" dpr={[1, 1.5]} camera={{ position: VIEWS[SCENE_CONFIG.startView].position, fov: VIEWS[SCENE_CONFIG.startView].fov, near: 0.5, far: 420 }}
        gl={{ antialias: true, powerPreference: 'high-performance', toneMapping: THREE.ACESFilmicToneMapping }}
        onCreated={({ gl }) => { gl.outputColorSpace = THREE.SRGBColorSpace; gl.shadowMap.type = THREE.PCFSoftShadowMap; }}
        fallback={<div className="error-panel"><h2>WebGL is unavailable</h2><p>Open this scene in a browser with hardware acceleration enabled.</p></div>}>
        <Lighting exposure={exposure} shadows={shadows} mode={mode} />
        <CityEnvironment />
        {/* <StreetLighting mode={mode} /> */}
        <Suspense fallback={null}><City onReady={onReady} wireframe={wireframe} /></Suspense>
        <CameraRig view={view} resetToken={resetToken} autoRotate={autoRotate} onCamera={onCamera} />
        {view==='concept' && <UserMarker />}
        {view==='concept' && <Suspense fallback={null}><NiroLogo play={!!ready} /></Suspense>}
        <Metrics onStats={setStats} />
        <Atmosphere strength={fogStrength} mode={mode} bloomEnabled={bloomEnabled} logoBloom={logoBloom} logoBloomRadius={logoBloomRadius} />
      </Canvas>
    </SceneBoundary>
    {debug && <pre className="camera-debug" data-testid="camera-debug">{JSON.stringify(cameraData,null,2)}</pre>}
    <header><div className="brand"><span className="brand-mark">D<span>•</span>C</span><div><strong>DARK CITY</strong><span>NEIGHBORHOOD EXPLORER</span></div></div><span className="live"><i />{ready ? 'LIVE 3D' : 'LOADING'}</span></header>
    <section className="intro"><span className="eyebrow">AFTER HOURS / A LOCAL WORLD</span><h1>{VIEWS[view].label}<span>.</span></h1><p>{VIEWS[view].description}</p></section>
    <aside className="tools"><button aria-expanded={settings} onClick={() => setSettings(s => !s)} className={settings ? 'active' : ''}>◐ <span>Scene settings</span></button>
      {settings && <div className="settings"><div className="setting-heading">MAKE IT YOUR VIEW</div><label>Light <select value={mode} onChange={e => setMode(e.target.value)}><option value="night">Blue hour</option><option value="day">Daylight</option></select></label><label className="range-label">Exposure <span>{exposure.toFixed(2)}</span><input aria-label="Exposure" type="range" min="0.5" max="2.5" step="0.05" value={exposure} onChange={e => setExposure(Number(e.target.value))} /></label><label className="range-label">Surrounding fog <span>{fogStrength.toFixed(2)}</span><input aria-label="Surrounding fog" type="range" min="0" max="2" step="0.05" value={fogStrength} onChange={e => setFogStrength(Number(e.target.value))} /></label><label>Soft shadows <input type="checkbox" checked={shadows} onChange={e => setShadows(e.target.checked)} /></label><label>Bloom (B)<input type="checkbox" checked={bloomEnabled} onChange={e=>setBloomEnabled(e.target.checked)}/></label><label className="range-label">Logo bloom <span>{logoBloom.toFixed(2)}</span><input aria-label="Logo bloom" type="range" min="0" max="1.5" step=".01" value={logoBloom} onChange={e=>setLogoBloom(+e.target.value)}/></label><label className="range-label">Logo bloom spread <span>{logoBloomRadius.toFixed(2)}</span><input aria-label="Logo bloom spread" type="range" min="0" max="1" step=".01" value={logoBloomRadius} onChange={e=>setLogoBloomRadius(+e.target.value)}/></label><label>Camera debug (D)<input type="checkbox" checked={debug} onChange={e=>setDebug(e.target.checked)}/></label><label>Wireframe <input type="checkbox" checked={wireframe} onChange={e => setWireframe(e.target.checked)} /></label><p>One shadow-casting light. Static city geometry stays batched.</p></div>}
    </aside>
    <footer>{SCENE_CONFIG.showViewTabs && <nav aria-label="Camera views">{Object.entries(VIEWS).map(([key], i) => <button key={key} aria-pressed={view === key} className={view === key ? 'selected' : ''} onClick={() => setView(key)}><span>0{i + 1}</span>{VIEWS[key].button}</button>)}</nav>}{!SCENE_CONFIG.lockCamera && <div className="playback"><button aria-label={autoRotate ? 'Pause orbit' : 'Auto orbit'} aria-pressed={autoRotate} onClick={() => setAutoRotate(a => !a)}>{autoRotate ? 'Ⅱ' : '▷'} <span>{autoRotate ? 'Pause orbit' : 'Auto orbit'}</span></button><button aria-label="Reset camera" onClick={() => setResetToken(n => n + 1)}>↺</button></div>}</footer>
    <div className="bottom-line"><span>{SCENE_CONFIG.lockCamera ? 'Move the cursor to look around' : <>Drag to orbit <b>·</b> Scroll to zoom <b>·</b> Right-drag to pan</>}</span><span className="metrics">{ready ? `${ready.meshes} batches · ${Math.round(ready.triangles / 1000)}k triangles · ${stats.calls || '—'} total main + FX draws` : 'Preparing scene'}</span></div>
    <Loading ready={ready} />
  </main>;
}

createRoot(document.getElementById('root')).render(<App />);




