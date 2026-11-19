import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    target: 'es2022',
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('/three/examples/jsm/postprocessing/') || id.includes('/three/examples/jsm/shaders/')) return;
          if (id.includes('/three/examples/')) return 'three-addons';
          if (id.includes('/node_modules/three/')) return 'three';
        },
      },
    },
    chunkSizeWarningLimit: 650,
  },
});
