import React from 'react';
import ReactDOM from 'react-dom/client';

import App from './App';
import './index.css';
import {applyThemeMode, readThemeMode} from './theme';

applyThemeMode(readThemeMode());

if (window.kisekiDesktop) document.documentElement.classList.add('desktop-shell');

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
