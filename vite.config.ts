import { defineConfig } from 'vite';

/**
 * Vite configuration for OPERATOR.
 *
 * Deliberately minimal for Document 1, but structured so later documents can
 * add plugins (e.g. a GLSL shader plugin in Document 6) without restructuring.
 */
export default defineConfig({
  // Project root is the repository root: index.html, /src, /assets, /public.
  root: '.',

  // /public is copied verbatim into dist/ by Vite (favicon, future draco/basis
  // decoder payloads). /assets is copied by tools/copyAssets.mjs after the
  // bundle step so the source-of-truth asset tree stays at the repo root.
  publicDir: 'public',

  server: {
    // Bind all interfaces so the sandbox live-preview proxy can reach us.
    host: true,
    // The preview is served through an external https://<port>-<sandbox>.e2b.app
    // host; Vite's DNS-rebinding guard would otherwise reject those Host headers.
    allowedHosts: true,
  },

  preview: {
    host: true,
    allowedHosts: true,
  },

  build: {
    target: 'es2022',
    outDir: 'dist',
    // Keep Vite's emitted bundle chunks out of dist/assets: that directory is
    // reserved for the mirrored game-asset tree (tools/copyAssets.mjs).
    assetsDir: 'bundle',
    // Large binary game assets must always be emitted as separate files, never
    // base64-inlined into JS. Anything resolved from the /assets tree (and any
    // obviously binary extension) opts out of inlining; everything else keeps
    // Vite's default behaviour.
    assetsInlineLimit: (filePath: string) => {
      const normalized = filePath.replace(/\\/g, '/');
      if (normalized.includes('/assets/') || normalized.startsWith('assets/')) return false;
      if (/\.(glb|gltf|ktx2|bin|wav|ogg|mp3|ico)$/.test(normalized)) return false;
      return undefined; // fall back to Vite's default threshold
    },
  },

  plugins: [
    // Document 1 needs no plugins. Later documents append here, e.g.:
    //   glslPlugin({ include: /\**\/*.glsl/ })   // Document 6
  ],
});
