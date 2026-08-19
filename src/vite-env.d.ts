/// <reference types="vite/client" />

// Short commit hash injected at build time by vite.config.ts.
declare const __GIT_HASH__: string;

interface ImportMetaEnv {
  // Points the app at a different worker than the deployed one — normally a
  // local `wrangler dev`, so a dev run can't edit the club's real data.
  // See REMOTE_URL in src/remote.ts.
  readonly VITE_REMOTE_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
