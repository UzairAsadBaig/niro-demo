# Dark City - React Three Fiber viewer

Open OPEN-CITY.html in Chrome or Edge. For development double-click start-viewer.cmd, then visit http://localhost:5173. Keep the terminal open. Existing dev-server users can refresh.

Install dependencies with npm install if needed. npm run build creates dist; node make-standalone.mjs refreshes the self-contained viewer.

## Controls
- 4: Concept Match (32 degree FOV, user-supplied camera position and target).
- O: reference overlay; opacity control in Scene settings.
- D: live selectable camera position, lookAt, FOV and marker screen percentages.
- B: bloom on/off; also available in Scene settings.
- Orbit, zoom, pan, exposure, daylight, wireframe, shadow and fog controls remain available.

All camera presets and lighting defaults are in src/scene-config.js. Concept Match now uses position [51.627, 34.979, 74.773] and lookAt [17.835, -19.618, 2.294]. The supplied camera readout placed the marker at 47.1% across and 45.9% down; screen percentages depend on viewport aspect ratio. Previous screenshots and verification reports document the earlier preset. Camera and fog configuration, layout, GLB textures and road base color were preserved during this lighting revision.

## Lighting refinement
Bloom is explicitly restricted to instanced lamp bulb cores, the street-lamp emissive material and the cyan marker. Buildings, shopfronts, food trucks, windows, facades and road pools render black or are hidden in the bloom source pass while opaque geometry still occludes sources. No brightness-threshold fallback is used for buildings.

Final settings:
- Bloom: strength 0.30, radius 0.18, threshold 0.25; full-resolution separable Gaussian blur.
- Facade window emissive intensity: 0.75. Prop emission: 1.1. Existing unlit windows remain unlit.
- Bulb sprite diameter: 0.36 world units; alpha multiplier 0.32; compact exponential core/falloff.
- Road pools: shared 512x512 RGBA radial texture, bilinear/trilinear filtering, zero alpha at the entire boundary; radius 1.45 world units and peak opacity 0.105 for regular lamps. Market lanterns: radius 1.25, opacity 0.10. Shop spill: opacity 0.055; truck spill: 0.065. All pools share one instanced draw.
- Nearby point lights: at most four, intensity 18, distance 6, no point-light shadows.
- ACES Filmic, exposure 1.55; half-float HDR scene/emission/blur targets; 4x MSAA on scene and emission; output dither 0.6/255 peak-to-peak.

The viewer suppresses the old broad ground emissive map and replaces it with localized pools. Base color, roughness and normal textures are unchanged. These are runtime viewer changes; loading the GLB alone does not include the new pool shaders or selective bloom.

## Verification and budget
Chrome WebGL checks passed without JavaScript/shader errors. All camera presets, O/D/B shortcuts, wireframe and shadow controls were exercised. lighting-verification.json records the bloom whitelist and comparison: Concept Match has 82 draws with bloom, 41 with bloom disabled; overview has 74 with bloom. Shadow passes are excluded. Model: 34 primitives, 3 materials, 153,872 triangles. These draw counts are not an FPS guarantee; full-resolution HDR bloom increases framebuffer memory and fill cost.

Screenshots include preview-concept.png, preview-bloom-off.png, preview-market.png and the overview/neighborhood views. The standalone file embeds the model and reference image. Start the development server from your desktop session if you want desktop-accessible localhost; the package does not claim an always-running server.

