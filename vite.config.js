import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
export default defineConfig({
  plugins: [react()],
  resolve: { preserveSymlinks: true },
  optimizeDeps: { esbuildOptions: { preserveSymlinks: true } },
  server: {
    allowedHosts: ['cobbler-subpar-stand.ngrok-free.dev'],
  }
});
