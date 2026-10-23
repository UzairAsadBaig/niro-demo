import { useMemo } from 'react';
import { useGLTF } from '@react-three/drei';
import * as THREE from 'three';
import { SCENE_CONFIG as C } from './scene-config';

export const MODEL = window.__CITY_MODEL_URL || '/dark-city.glb';
export const STAGES = C.story.stages.length;

// Shared story time. Set from the (Lenis-smoothed) page scroll; jump() is for the console and tests.
export const story = { s:0, jump(s) { this.s = s; } };
window.__story = story;

export const clamp01 = x => Math.min(1, Math.max(0, x));
export const ramp = (s, [a, b]) => clamp01((s - a) / (b - a));
export const ease = x => x * x * (3 - 2 * x);
export const easeInOut = x => x < .5 ? 4 * x * x * x : 1 - (-2 * x + 2) ** 3 / 2;

// Story time at which the return stream reaches a place, and that place's 0→1 activation.
export function arrival(id) {
  const T = C.timeline.returns, j = C.routes.returns.findIndex(r => r.to === id);
  return j < 0 ? Infinity : T.start + j * T.stagger + T.travel;
}
export const activation = (id, s) => ease(ramp(s, [arrival(id) - .03, arrival(id) + .12]));

// FT01 position on its A→B path at story time s (eased: pulls away, cruises, parks).
export function ft01At(s, world) {
  const pts = world.paths.FT01_A_to_B || [C.ft01.from, C.ft01.to].map(p => new THREE.Vector3(...p));
  const lengths = pts.slice(1).map((p, i) => p.distanceTo(pts[i])), total = lengths.reduce((a, b) => a + b, 0);
  let d = easeInOut(ramp(s, C.timeline.truck)) * total, i = 0;
  const travelled = d;
  while (i < lengths.length - 1 && d > lengths[i]) d -= lengths[i++];
  const a = pts[i], b = pts[i + 1];
  // heading: rotation-y that points a vehicle's local +x (its nose) along the path.
  return { position:a.clone().lerp(b, Math.min(1, d / lengths[i])), heading:Math.atan2(a.z - b.z, b.x - a.x), travelled };
}
export const ft01Live = (s, world) => ft01At(s, world).position.add(new THREE.Vector3(...C.ft01.live));

// Anchors and paths come from the GLB when the designer ships them (spec §9 names), otherwise from the config,
// so a re-exported city drops in without code changes.
export function useWorld() {
  const { scene } = useGLTF(MODEL);
  return useMemo(() => {
    scene.updateMatrixWorld(true);
    const anchors = {}, paths = {}, nodes = {};
    for (const [key, p] of Object.entries(C.anchors)) anchors[key] = new THREE.Vector3(...p);
    scene.traverse(o => {
      nodes[o.name] = o;
      if (o.name.startsWith('Anchor_')) anchors[o.name.slice(7)] = o.getWorldPosition(new THREE.Vector3());
      if (o.name.startsWith('Path_')) paths[o.name.slice(5)] = pathPoints(o);
    });
    const fromGlb = name => !!nodes['Anchor_' + name];
    return { scene, anchors, paths, nodes, fromGlb };
  }, [scene]);
}

// A path node is either a parent of ordered empties or a polyline/mesh whose vertices are in order.
function pathPoints(node) {
  const points = [];
  if (node.geometry) {
    const p = node.geometry.attributes.position, v = new THREE.Vector3();
    for (let i = 0; i < p.count; i++) {
      v.fromBufferAttribute(p, i).applyMatrix4(node.matrixWorld);
      if (!points.length || points.at(-1).distanceToSquared(v) > 1e-4) points.push(v.clone());
    }
  } else {
    [...node.children].sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric:true }))
      .forEach(c => points.push(c.getWorldPosition(new THREE.Vector3())));
  }
  return points.length > 1 ? points : null;
}
