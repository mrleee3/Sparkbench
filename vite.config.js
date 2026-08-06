import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

/* Project Pages serve from https://<user>.github.io/<repo>/ , so assets need
   that prefix. Override with BASE_PATH=/ for a custom domain or local preview. */
const base = process.env.BASE_PATH ?? '/sparkbench/';

export default defineConfig({
  base,
  plugins: [react()],
  build: { outDir: 'dist', sourcemap: false },
});
