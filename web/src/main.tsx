import React from 'react';
import ReactDOM from 'react-dom/client';

import App from './App';
import './index.css';

if (window.kisekiDesktop) document.documentElement.classList.add('desktop-shell');

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
