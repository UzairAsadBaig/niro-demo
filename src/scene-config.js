// Story time `s` runs 0→5 while scrolling: one unit per storyboard stage (01 quiet city … 05 live pulse).
// Every animated value below is a pure function of `s`, so reverse scrolling replays the story backwards.
export const SCENE_CONFIG = {
  story: {
    scrollPerStage: 1.15, // viewport heights of scrolling per stage
    lerp: .075,           // Lenis smooth-scroll lerp: lower = silkier and slower to settle
    stages: [
      { title:'The quiet city', copy:'A quiet local world, centered on the user.', fog:1 },
      { title:'Signals gather', copy:'Nearby signals gather into a shared intelligence.', fog:1.12 },
      { title:'NIRO assembles', copy:'Every local signal comes together as one intelligence.', fog:1.2 },
      { title:'Intelligence flows', copy:'The icon gently dissolves into guided local particle streams.', fog:1 },
      { title:'Live Pulse', copy:'Nearby activity comes alive, then blends into the dark landing page.', fog:.6 },
    ],
  },
  // Story-time windows [from, to] for each beat. Signal/return heads are staggered per route.
  timeline: {
    signals: { start:.8, stagger:.07, travel:.85 }, // source streams grow to the user anchor, then climb into the icon
    assemble: [2.0, 2.8],                           // icon builds from the converging particles
    drain: [2.5, 3.05],                             // source streams finish flowing into the icon
    dissolve: [3.3, 4.35],                          // icon dissolves from its lower edge into the return streams
    returns: { start:3.15, stagger:.1, travel:.6 }, // a destination activates when its stream arrives
    settle: [4.1, 4.5],                             // return streams let go of the icon and run from the user anchor
    truck: [3.3, 4.55],                             // FT01 drives from A to B
    labels: { start:4.3, stagger:.12, fade:.18 },
  },
  // Keys at story time s. Targets are look-at points. Portrait screens use a separate curve: `mobileTarget`
  // (defaults to target), with the camera pulled back `mobileDistance` (default mobile.distance) along the same view line.
  camera: {
    keys: [
      { s:0,   position:[-75.17,47.38,62.31], target:[.9,0,3.1], fov:32, mobileTarget:[-7,0,8], mobileDistance:1.5 },
      { s:.6,  position:[-73.05,46.06,60.65], target:[.9,0,3.1], fov:32, mobileTarget:[-7,0,8], mobileDistance:1.5 },
      { s:1.5, position:[-60,38,50.5],        target:[-.5,0,4.2], fov:34, mobileTarget:[-7,0,7.5] },
      { s:2.5, position:[-37.5,27.5,31],      target:[-9.3,10.4,9.1], fov:36 },
      { s:3.5, position:[-44,29,27],          target:[-4.5,4,7.5], fov:38 },
      { s:4.5, position:[-37.5,24,36.5],      target:[-3.5,1,10], fov:41, mobileTarget:[0,1,7], mobileDistance:2.65 },
      { s:5,   position:[-36.4,23.2,35.6],    target:[-3.5,1,10], fov:42, mobileTarget:[0,1,7], mobileDistance:2.65 },
    ],
    mobile: { distance:1.75, fov:6 },
  },
  // Cursor parallax (world units at the stage-1 distance; scaled down as the camera moves in).
  parallax: { x:3, y:1.5, ease:3 },
  // Fallback positions. A GLB node named Anchor_<key> (e.g. Anchor_Restaurant_01) replaces the value here.
  anchors: {
    User:[-9.3,.13,9.1],
    NIRO_Assemble:[-9.3,15.5,9.1],
    Restaurant_01:[-20.3,1.6,6.2], // under the striped awning
    Service_01:[-.4,1.6,1.8],      // SHOP / SERVICE corner building, west (SERVICE sign) face
    Event_01:[29.8,1.6,.6],        // in front of the concert stage
    FoodTruckPark_01:[8.7,1.8,18], // centre of the designer's food-truck lot
  },
  // Opportunity places (the props themselves come from the GLB). `kind`/`facing` place the activation light and ground pool.
  // `zones` [[x, z, radius], ...]: must cover the whole place (fully dark inside 85% of the radius). The designer's props
  // inside stay dark and desaturated until this place activates. Service also owns the second SHOP building up north; the truck park owns the kiosk plaza west of the lot
  // and the green park beyond it.
  places: [
    { id:'Restaurant_01', kind:'restaurant', facing:0, zones:[[-19.8,2.4,8]], label:'Lunch Deal · 0.4 mi', labelSide:-1, light:'#ffb86b',
      lamp:[0,2.6,-2.6], pool:[0,-2.6,3.6] }, // over the terrace tables (local to the anchor)
    { id:'Service_01', kind:'service', facing:-Math.PI/2, zones:[[2.5,2,6.5],[-.2,-19.7,6]], label:'Service Open Now', labelSide:-1, narrowLift:32, light:'#ffb86b' },
    { id:'Event_01', kind:'event', facing:-Math.PI/2, zones:[[34.1,.6,8]], label:'Event Starts in 12m', labelSide:1, light:'#ffd19a', wash:['#6A8EFE', 5], hanging:/^Event_Lights$/,
      glow:{ nodes:/^musical_Cencert$/, color:'#9CB4FE', intensity:120, distance:14, height:2.4 } },
    { id:'FoodTruckPark_01', kind:'trucks', facing:0, zones:[[8.9,18.4,13],[-6.5,18.2,9],[-19,18,9.8]], label:'4 Food Trucks Live', labelSide:1, light:'#ffb86b', hanging:/^Lights1?$/,
      glow:{ material:/^Truck_Inside_Light$/, color:'#ffc27d', intensity:5, distance:3.2, height:-.35 } }, // soft fill under each tube light
  ],
  // `narrowLift` (px): raises the label above its neighbours on phone-width screens.
  // `glow`: a light inside each GLB node matching `nodes`, or each mesh using `material` (the stage, the truck tube lights),
  // `height` above the node's bottom; on with the place's activation.
  // `lamp` [x, y, z] / `pool` [x, z, radius]: activation light and ground glow, local to the anchor (front = +z).
  // `hanging`: GLB meshes of festoon string lights; unlit until the place activates (street lamps outside place zones stay lit).
  // `wash`: [colour, intensity] light wash over the props in the zone once active (the lit stage).
  // Dormant look inside place zones (stage 1 reads as the dark concept city): lit brightness, albedo saturation, the
  // remaining share of emission (shop interiors, truck windows, lamps) and the emission boost once active.
  dormant:{ materials:/^(Buildings_Mat|stylized bush|Plant_1_Mat|Plant_3_Mat|Plant_Big_Mat|Tall_Buildings_Mat|Shops_Interior_Mat|Vehicle_Window_Emission|Truck_Inside_Light|Signs_Mat|Emission|Palette256)$/, brightness:.32, saturation:.3, emission:0, glow:1.8 },
  // Emission strength per designer material (their emission textures): city windows, shop interiors, truck windows, signs, lamps.
  emission:{ Buildings_Mat:1.9, Tall_Buildings_Mat:2.4, Shops_Interior_Mat:1.4, Vehicle_Window_Emission:1.2, Truck_Inside_Light:2.2, Signs_Mat:1.5, Emission:4 },
  // City windows start dim and warm up to `emission` over story time `ramp` (`dim` = starting share of the strength).
  windows:{ materials:/^(Buildings_Mat|Tall_Buildings_Mat)$/, dim:.2, ramp:[.6, 3.9] },
  // Characters start dark (`dim` = starting albedo multiplier) so they sit in the night scene, then brighten over `ramp`.
  characters:{ materials:/^(Char_Mat|Male_V1_Shirt_Mat|Male_V2_Shirt_Mat)$/, dim:.3, ramp:[.6, 3.9] },
  // Emission colour overrides per designer material (their export is plain white): warm tube lights inside the trucks.
  emissionColor:{ Truck_Inside_Light:'#ffd29a' },
  // FT01, the moving truck: shown only once the GLB ships FT01_Mobile_Root (moved along Path_FT01_A_to_B, or from → to).
  ft01: { from:[-9.9,0,-40], to:[-9.9,0,-1.2], live:[0,3.4,0] },
  // Particle routes. Sources run from → via → Anchor_User → rise into the icon; returns run icon → via → place.
  // A GLB node Path_<id> (children empties in order, or a polyline mesh) replaces the waypoints.
  // Lanes keep the lines apart: each approaches the user on its own lane (the road is z 7-11 east-west, x -11..-7 north-south)
  // and every lane's order matches the order it reaches the user in, so no two routes cross. East lanes, north to south:
  // Event 8.3, East 9.2, Tower_E 10.1, Food trucks 10.9. West lanes: Restaurant 8.2, West 9.1, Tower_W 10.4.
  // Service follows the north arm of the road (the lane east of the North lines), then turns east across the pavement between
  // the street trees (x -4.2, z -0.3 and 4.8) to its SERVICE face.
  routes: {
    sources: [
      { id:'Source_Restaurant', from:'Restaurant_01', via:[[-18,1.1,7.7],[-14,.95,8.2],[-11.5,.9,8.5]] },
      { id:'Source_Service', from:'Service_01', via:[[-2.2,1.1,2.1],[-4.2,1.05,2.7],[-6,1.05,2.95],[-7,1.02,3.2],[-7.45,1,3.9],[-7.5,.95,5.5],[-7.9,.9,7.4]] },
      { id:'Source_FoodTruck', from:'FoodTruckPark_01', via:[[7,1.3,16.5],[7,1.1,11.6],[4,1,10.9],[-4,.95,10.6]] },
      { id:'Source_Event', from:'Event_01', via:[[28.6,1.2,4],[28.2,1.1,8.3],[20,1,8.3],[8,1,8.3],[-4,.9,8.6]] },
      { id:'Source_North', from:[-9.6,6,-52], via:[[-9.4,1.4,-30],[-9.6,1.1,-12],[-9.6,.95,0],[-9.6,.85,5]], width:1.2 },
      { id:'Source_NorthEast', from:[36,6,-9.4], via:[[20,1.4,-9.2],[-4,1.1,-8.8],[-8.2,1,-5.5],[-8.5,.9,1],[-8.6,.85,5]], width:1.2 },
      { id:'Source_West', from:[-52,6,9.4], via:[[-32,1.4,9.1],[-16,1,9.1],[-12,.9,9.1]], width:1.2 },
      { id:'Source_South', from:[-9.3,6,52], via:[[-9.3,1.4,32],[-9.3,1.1,18],[-9.3,.9,13]], width:1.2 },
      { id:'Source_East', from:[52,6,8.4], via:[[30,1.4,9.2],[16,1.2,9.2],[3,1.1,9.2],[-4,.95,9.2]], width:1.2 },
      { id:'Source_Tower_W', from:[-30,16,44], via:[[-29.2,1.6,28],[-29.2,1.2,11],[-22,1,10.4],[-12,.9,10.2]], width:1.1 },
      { id:'Source_Tower_E', from:[52,16,10.4], via:[[30,1.4,10.1],[16,1.2,10.1],[3,1.1,10.1],[-4,.95,9.9]], width:1.1 },
    ],
    returns: [
      { id:'Return_Restaurant', to:'Restaurant_01', via:[[-11.5,1,8.5],[-14,1,8.2],[-18,1.1,7.7]] },
      { id:'Return_Service', to:'Service_01', via:[[-7.9,1,7.4],[-7.5,1,5.5],[-7.45,1,3.9],[-7,1.02,3.2],[-6,1.05,2.95],[-4.2,1.05,2.7],[-2.2,1.1,2.1]] },
      { id:'Return_Event', to:'Event_01', via:[[-4,1,8.6],[8,1.1,8.3],[20,1.1,8.3],[28.2,1.2,8.3],[28.6,1.3,4]] },
      { id:'Return_FoodTruck', to:'FoodTruckPark_01', via:[[-4,1.1,10.6],[4,1.1,10.9],[7,1.2,11.6],[7,1.4,16.5]] },
      { id:'Return_FT01', to:'FT01_Live', via:[[-9.4,1.6,4.6]] },
    ],
  },
  streams: {
    density:32,            // particles per metre of route (they sparkle around the light lines)
    width:.5,              // tube radius in metres
    speed:[3.5,7],         // flow speed range, metres per second
    color:'#0743FC', bright:'#3969FD', sparkle:'#6A8EFE', // brand Primary Blue and its 80% / 60% tints, so overlaps don't clip to white
    intensity:3.4,         // HDR multiplier (emissive 3-6 per the spec, tuned with bloom)
    line:{ strands:2, width:.025, brightness:.28 }, // braided light lines per route; width in metres (clamped to 1.4-4 px)
  },
  marker: { radius:1.3, beamHeight:5, color:'#4DD7CB' }, // brand Signal Aqua
  aqua:'#4DD7CB', // brand Signal Aqua
  // face: linear RGB, like Devfum's bloom layer (emissive [.40,.53,1] x 46). Only pixels above bloom.threshold bloom.
  // The icon sits at anchors.NIRO_Assemble.
  logo: { size:6, color:'#0743FC', faceStrength:.65, glowStrength:1.8, bloom:{ threshold:0, smoothing:0, intensity:1, levels:9, radius:.6 }, reveal:{ count:4000, span:.35, brightness:2.5, flash:1.5, spread:9 }, dust:{ count:260, color:[.45,.65,1], brightness:3 },
    // Noise dissolve (after the Codrops emissive-dissolve demo): a vertical bias keeps it bottom-up, `noise` sets how ragged the
    // burning edge is, `freq` its blob size (icon units), `edge` the glowing band width, `intensity` its HDR brightness.
    dissolve:{ freq:7, noise:.26, edge:.045, color:'#6A8EFE', intensity:4 },
    // Fine sparks that lift off the glowing edge and fade as they rise.
    embers:{ count:2200, size:.07, travel:1.3, speed:.55, color:'#9CB4FE', brightness:3.2 } },
  atmosphere: { top:'#0c1016', horizon:'#2a313b', smoke:'#4b535f', smokeAmount:.85, saturation:.72, vignette:.62, depthStartOffset:18, density:.023, heightFalloff:.055, upperDensity:.28, edgeFadeWidth:5, bounds:[-54,67,-72,54], strength:1 },
  // Narrow selective bloom plus a wide, soft halo (mipmap bloom) around the same warm emitters.
  bloom: { strength:.30, radius:.18, threshold:.25, resolution:1, wide:{ strength:.85, radius:.7, levels:6 } },
  lighting: { lampColor:'#ffad5c', lampEmission:4, exposure:1.55, placeLight:26, bulbSize:.36, bulbOpacity:.32, poolTextureSize:512, poolRadius:1.45, poolOpacity:.105, nearbyLightIntensity:18, nearbyLightDistance:6, dither:0.6 },
  landing:'#000000', // landing-page background (brand Pure Black; must match Chirag's page); the story fades into it
};
