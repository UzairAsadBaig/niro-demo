# NIRO — cinematic scroll story (React Three Fiber)

`npm install`, then `npm run dev` and open http://localhost:5173. `npm run build` creates `dist/`.

## The story
Scrolling drives a story time `s` from 0 to 5, one unit per storyboard stage:

| s | Stage | What happens |
|---|-------|--------------|
| 0–1 | 01 The quiet city | Dormant city, user pulse, slow arrival drift |
| 1–2 | 02 Signals gather | Blue streams grow from the opportunities and the wider city to the user anchor |
| 2–3 | 03 NIRO assembles | Streams braid up from the anchor; the icon builds bottom-up from the particles |
| 3–4 | 04 Intelligence flows | The icon dissolves from its lower edge into return streams; each place lights up when its stream arrives; FT01 drives in |
| 4–5 | 05 Live Pulse | Three projected labels, quieter streams, then the page hands off to the landing section |

Scrolling is smoothed by [Lenis](https://github.com/darkroomengineering/lenis) (skipped when the user prefers reduced motion) and `s` follows it directly. Everything is a pure function of `s`, so reverse scrolling replays the story. All timing, camera keys, anchors, places, routes and particle settings live in `src/scene-config.js`:
- `story`: copy per stage, scroll length per stage, Lenis smooth-scroll `lerp`, per-stage fog multiplier.
- `timeline`: story-time windows for each beat.
- `camera.keys`: position/target/FOV keys on the timeline. The camera follows Catmull-Rom curves through them with a monotone time mapping, so it never stops at a key. Portrait screens use `mobileTarget`/`mobileDistance`.
- `anchors`, `places`, `ft01`, `routes`, `streams`.

## Model updates (designer GLBs)
`public/dark-city.glb` can be replaced without code changes. When present in the GLB (spec §9 names), these override the config:
- `Anchor_User`, `Anchor_NIRO_Assemble`, `Anchor_Restaurant_01`, `Anchor_Service_01`, `Anchor_Event_01`, `Anchor_FoodTruckPark_01`: marker, label and stream endpoints. Place props (trucks, tables, signs) come only from the GLB.
- `Path_Source_<Name>` / `Path_Return_<Name>` (route ids are in `routes`): either a parent of ordered empties or a polyline mesh.
- `FT01_Mobile_Root` (moved along `Path_FT01_A_to_B`, or `ft01.from/to`). Until it exists there is no moving truck, FT01 marker or FT01 return stream.
- Inside each place's `zones`, props using the `dormant.materials` stay dark and desaturated with their emission off until the place activates, then return to full colour with their emission boosted. Emission strength per designer material is `emission` in the config. This is position based, so merged or renamed meshes keep working.

`public/niro-logo.glb`: every mesh is treated as one icon part. When the four official components are shipped as separate meshes, they fly together during assembly.

## Rendering notes
- Signal streams (`SignalStreams.jsx`): about 56k GPU particles in one draw. Routes are baked into a float texture; each particle flows along its route in a braided tube, with hot leading edges, halo strays and bokeh motes. Each route gets a head/tail window from story time.
- An energy pass (`Atmosphere.jsx`) renders the icon glow face, particles and Aqua markers over a black, alpha-0 copy of the city, so their wide bloom is occluded by buildings. Street lamps and warm interiors keep the narrow selective bloom.
- Live Pulse labels are DOM overlays (drei `Html`), outside WebGL tone mapping.
- Rendering stops once the landing section fully covers the canvas.

## Dev tools
- `?dev` shows the scene settings panel (exposure, fog, bloom, shadows, wireframe, draw counts).
- `D` toggles the camera readout (story time, position, lookAt, FOV) for tuning `camera.keys`.
- `B` toggles bloom. `window.__story.jump(s)` jumps the story from the console.
