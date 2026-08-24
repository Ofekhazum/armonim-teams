import { execSync } from 'node:child_process';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// Short commit hash baked into the build, so the roster page can show a
// version marker that visibly changes on every deploy.
const gitHash = (() => {
  try {
    return execSync('git rev-parse --short HEAD').toString().trim();
  } catch {
    return 'dev';
  }
})();

export default defineConfig(({ command }) => ({
  // GitHub Pages serves the site from /<repo-name>/
  base: command === 'build' ? '/armonim-teams/' : '/',
  plugins: [react(), tailwindcss()],
  define: {
    __GIT_HASH__: JSON.stringify(gitHash),
  },
}));