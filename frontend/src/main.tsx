import React from 'react';
import ReactDOM from 'react-dom/client';
import { initBrowserCompat } from './utils/browserCompat';
import { purgeLegacyMockStorage } from './utils/purgeLegacyMockStorage';
import './index.css';
import App from './App';

initBrowserCompat();
purgeLegacyMockStorage();

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error("Could not find root element to mount to");
}

const root = ReactDOM.createRoot(rootElement);
root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);