import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import RoomGuest from './components/RoomGuest';
import { LangProvider, useI18n } from './lang';
import './index.css';

// A shared room link (?room=<id>) drops straight into the restricted guest
// view instead of the normal app — no router needed for one query param.
const roomId = new URLSearchParams(window.location.search).get('room');

/**
 * Subscribes to the language so that changing it re-renders the whole app.
 *
 * This has to be its own component rather than the `children` handed to
 * `LangProvider` (§2.45). `children` arrives as one element created once, out
 * here — React sees the same element again on the provider's re-render and
 * skips the subtree entirely, so the toggle would swap `<html dir>` and
 * nothing else on the page. Reading the context *below* the provider is what
 * makes a fresh `<App />`, and everything under it, on every switch.
 *
 * Most components then read their labels from the module-level `t()` rather
 * than through a hook — see the note in `i18n.ts`. This is the render that
 * makes that work.
 */
function Root() {
  useI18n();
  return roomId ? <RoomGuest roomId={roomId} /> : <App />;
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <LangProvider>
      <Root />
    </LangProvider>
  </React.StrictMode>,
);
