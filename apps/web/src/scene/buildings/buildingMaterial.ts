/**
 * Procedural facade material: MeshStandardMaterial extended with a window grid
 * computed in object space. Per-instance attribute aBuild =
 *   (seed, windowDensity, facadeType + 10*storefront, occupancy bias).
 * Windows reflect the sky by day and light up at night in proportion to the
 * building's real occupancy from the simulation.
 */
import * as THREE from 'three';
import { GLSL_HASH, env } from '../env';

export type ShapeKind = 'box' | 'cylinder' | 'hex';

export function createBuildingMaterial(shape: ShapeKind): THREE.MeshStandardMaterial {
  const mat = new THREE.MeshStandardMaterial({ roughness: 0.78, metalness: 0.15, envMapIntensity: 0.6 });
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uNight = env.uNight;
    shader.uniforms.uTime = env.uTime;
    shader.uniforms.uWet = env.uWet;
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        /* glsl */ `#include <common>
        attribute vec4 aBuild;
        varying vec2 vFacade;
        varying float vRoof;
        varying vec4 vBuild;
        varying float vLocalY;`,
      )
      .replace(
        '#include <begin_vertex>',
        /* glsl */ `#include <begin_vertex>
        vec3 bSc = vec3(length(instanceMatrix[0].xyz), length(instanceMatrix[1].xyz), length(instanceMatrix[2].xyz));
        vec4 bWp = modelMatrix * instanceMatrix * vec4(position, 1.0);
        ${
          shape === 'box'
            ? 'float bU = abs(normal.x) > 0.5 ? position.z * bSc.z : position.x * bSc.x;'
            : 'float bU = atan(position.z, position.x) * 0.5 * bSc.x;'
        }
        vFacade = vec2(bU, bWp.y);
        vRoof = normal.y;
        vBuild = aBuild;
        vLocalY = position.y;`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        /* glsl */ `#include <common>
        uniform float uNight;
        uniform float uTime;
        uniform float uWet;
        varying vec2 vFacade;
        varying float vRoof;
        varying vec4 vBuild;
        varying float vLocalY;
        ${GLSL_HASH}
        float bWin; vec3 bWinCol; float bLit;`,
      )
      .replace(
        '#include <color_fragment>',
        /* glsl */ `#include <color_fragment>
        float isWall = 1.0 - step(0.5, abs(vRoof));
        float ftRaw = vBuild.z;
        float storefront = step(9.5, ftRaw);
        float ft = ftRaw - storefront * 10.0;
        vec2 cs; vec2 wf;
        if (ft < 0.5) { cs = vec2(1.3, 1.6); wf = vec2(0.8, 0.68); }
        else if (ft < 1.5) { cs = vec2(1.5, 1.6); wf = vec2(0.52, 0.55); }
        else if (ft < 2.5) { cs = vec2(3.6, 1.6); wf = vec2(0.97, 0.42); }
        else if (ft < 3.5) { cs = vec2(2.6, 3.2); wf = vec2(0.22, 0.3); }
        else if (ft < 4.5) { cs = vec2(3.2, 3.0); wf = vec2(0.6, 0.16); }
        else if (ft < 5.5) { cs = vec2(1.7, 1.6); wf = vec2(0.42, 0.5); }
        else { cs = vec2(1000.0); wf = vec2(0.0); }
        vec2 g = vFacade / cs;
        vec2 cell = floor(g);
        vec2 f = fract(g);
        vec2 m = step(abs(f - 0.5), wf * 0.5);
        float aboveGround = step(1.2, vFacade.y);
        bWin = m.x * m.y * isWall * aboveGround;
        // ground-floor storefront glazing for shops, cafes and restaurants
        float shopBand = storefront * isWall * (1.0 - step(2.6, vFacade.y)) * step(0.35, vFacade.y);
        float shopMask = shopBand * step(0.08, fract(vFacade.x / 2.4)) ;
        float h = mHash12(cell + vBuild.x * 113.0);
        float h2 = mHash12(cell.yx * 1.7 + vBuild.x * 71.0);
        float slow = floor(uTime / 45.0 + vBuild.x * 9.0);
        float flick = mHash12(cell + slow);
        float litRatio = mix(0.03, 0.3, uNight) * (0.5 + vBuild.y * 0.5) + vBuild.w * 0.6;
        bLit = step(mix(h, flick, 0.15), litRatio);
        vec3 warm = vec3(1.0, 0.74, 0.42);
        vec3 cool = vec3(0.52, 0.78, 1.0);
        vec3 neonc = vec3(0.85, 0.35, 1.0);
        bWinCol = h2 < 0.58 ? warm : (h2 < 0.93 ? cool : neonc);
        vec3 glassDay = mix(vec3(0.07, 0.11, 0.17), vec3(0.16, 0.24, 0.34), clamp(vFacade.y / 80.0, 0.0, 1.0));
        diffuseColor.rgb = mix(diffuseColor.rgb, glassDay, bWin * 0.85);
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.05, 0.06, 0.08), shopMask);
        float floorLine = step(0.965, fract(vFacade.y / 1.6)) * isWall * (1.0 - step(5.5, ft));
        diffuseColor.rgb *= 1.0 - floorLine * 0.35;
        diffuseColor.rgb *= mix(1.0, 0.62, step(0.5, vRoof));
        // subtle ground grime and top accent
        diffuseColor.rgb *= 0.82 + 0.18 * smoothstep(0.0, 6.0, vFacade.y);
        bWin = max(bWin, shopMask);
        bLit = max(bLit * (1.0 - shopMask), shopMask * step(0.25, uNight + 0.3));
        bWinCol = mix(bWinCol, vec3(1.0, 0.85, 0.65), shopMask);`,
      )
      .replace(
        '#include <roughnessmap_fragment>',
        /* glsl */ `#include <roughnessmap_fragment>
        roughnessFactor = mix(roughnessFactor, 0.12, bWin);`,
      )
      .replace(
        '#include <metalnessmap_fragment>',
        /* glsl */ `#include <metalnessmap_fragment>
        metalnessFactor = mix(metalnessFactor, 0.65, bWin * (1.0 - bLit));`,
      )
      .replace(
        '#include <emissivemap_fragment>',
        /* glsl */ `#include <emissivemap_fragment>
        totalEmissiveRadiance += bWinCol * bWin * bLit * (0.08 + 1.15 * uNight) * (0.45 + 0.55 * h2);`,
      );
  };
  mat.customProgramCacheKey = () => `morphis-building-${shape}`;
  return mat;
}

/** Simple emissive material for neon strips (boosted for bloom at night). */
export function createNeonMaterial(): THREE.MeshBasicMaterial {
  const mat = new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false });
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uNight = env.uNight;
    shader.uniforms.uTime = env.uTime;
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float uNight;\nuniform float uTime;')
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        diffuseColor.rgb *= 0.55 + 2.4 * uNight;`,
      );
  };
  mat.customProgramCacheKey = () => 'morphis-neon';
  return mat;
}
