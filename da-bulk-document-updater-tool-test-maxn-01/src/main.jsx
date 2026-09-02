import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { setToken } from './api/daApi.js';
import './index.css';
import App from './App.jsx';

async function initToken() {
  const local = import.meta.env.VITE_DA_TOKEN;
  if (local) {
    setToken(local);
    return;
  }
  try {
    const SDK = await Promise.race([
      import(/* @vite-ignore */ 'https://da.live/nx/utils/sdk.js'),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error('SDK load timeout')), 10000)
      ),
    ]);
    const data = await Promise.race([
      SDK.default,
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error('Token retrieval timeout')), 5000)
      ),
    ]);
    if (data?.token) setToken(data.token);
  } catch {
    setToken(null);
  }
}

async function main() {
  await initToken();
  const container = document.getElementById('root');
  if (!container) return;
  createRoot(container).render(
    <StrictMode>
      <App />
    </StrictMode>
  );
}

main();
