import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig(({ command }) => ({
  // GitHub Pages serves the site from /<repo-name>/
  base: command === 'build' ? '/armonim-teams/' : '/',
  plugins: [react(), tailwindcss()],
}));
