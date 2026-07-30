import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import RoomGuest from './components/RoomGuest';
import './index.css';

// A shared room link (?room=<id>) drops straight into the restricted guest
// view instead of the normal app — no router needed for one query param.
const roomId = new URLSearchParams(window.location.search).get('room');

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>{roomId ? <RoomGuest roomId={roomId} /> : <App />}</React.StrictMode>,
);
