import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vite';

// Deployed as a GitHub Pages project site at https://knottx.dev/datetime/
export default defineConfig({
  base: '/datetime/',
  plugins: [tailwindcss()],
  // Fixed ports so the VS Code debug configurations always find the server.
  server: { port: 5173, strictPort: true },
  preview: { port: 4173, strictPort: true },
  build: {
    target: 'es2022',
  },
});
