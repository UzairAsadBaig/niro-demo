export const SCENE_CONFIG = {
  // The other camera presets stay available (key 4 / code); only Concept Match is shown for now.
  startView:'concept', showViewTabs:false,
  // Camera is fixed on startView; it only drifts with the cursor (x/y in world units, ease = follow speed).
  lockCamera:true, parallax:{ x:3, y:1.5, ease:3 },
  cameras: {
    overview: { position: [-56,73,123], target: [8,3,-8], fov:43, duration:1.5, easing:'cubicInOut', button:'Overview', label:'The quiet city', description:'A neighborhood of warm windows, wrapped in evening mist.' },
    district: { position:[69,43,83], target:[27,2,23], fov:43, duration:1.5, easing:'cubicInOut', button:'Neighborhood', label:'The neighborhood', description:'Corner cafés, outdoor tables, and a night market.' },
    market: { position:[59,21,60], target:[43,1.5,35.5], fov:43, duration:1.5, easing:'cubicInOut', button:'Food market', label:'The night market', description:'Five food trucks gathered around the square.' },
    concept: { position:[-73.046,46.056,60.654], target:[15.579,-9.094,-8.364], fov:32, duration:1.8, easing:'cubicInOut', button:'Concept Match', label:'Concept Match', description:'Frame 01 · Press D for camera values.' },
  },
  marker: { position:[-9.3,.13,9.1], radius:1.3, beamHeight:5, color:'#35eaff' },
  // face: linear RGB, like Devfum's bloom layer (emissive [.40,.53,1] x 46). Only pixels above bloom.threshold bloom.
  logo: { position:[-9.3,15.5,9.1], size:6, color:'#0743FD', faceStrength:.65, glowStrength:1.8, bloom:{ threshold:0, smoothing:0, intensity:1, levels:9, radius:.6 }, reveal:{ count:4000, start:.6, stagger:1.2, flight:2.4, brightness:2.5, flash:1.5 }, dust:{ count:260, color:[.45,.65,1], brightness:3 } },
  atmosphere: { top:'#0c1016', horizon:'#2a313b', smoke:'#4b535f', smokeAmount:.85, saturation:.72, vignette:.62, depthStartOffset:18, density:.023, heightFalloff:.055, upperDensity:.28, edgeFadeWidth:5, bounds:[-54,67,-72,54], strength:1 },
  bloom: { strength:.30, radius:.18, threshold:.25, resolution:1 },
  lighting: { lampColor:'#ffad5c', lampEmission:4, exposure:1.55, windowEmission:.75, propEmission:1.1, bulbSize:.36, bulbOpacity:.32, poolTextureSize:512, poolRadius:1.45, poolOpacity:.105, nearbyLightIntensity:18, nearbyLightDistance:6, dither:0.6 },
};




