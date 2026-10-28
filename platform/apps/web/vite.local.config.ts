import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
export default defineConfig({
  plugins: [
    react(),
    {
      name: 'clean-local-output',
      buildStart() {
        const output = fileURLToPath(
          new URL('../../connector/internal/localhttp/assets', import.meta.url),
        );
        for (const name of readdirSync(output))
          if (name !== 'README.txt') rmSync(join(output, name), { recursive: true, force: true });
      },
    },
  ],
  base: '/',
  build: {
    outDir: '../../connector/internal/localhttp/assets',
    emptyOutDir: false,
    rollupOptions: { input: fileURLToPath(new URL('./local.html', import.meta.url)) },
  },
});
