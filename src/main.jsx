import React from 'react';
import { createRoot } from 'react-dom/client';
import Sparkbench from './Sparkbench.jsx';

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <Sparkbench />
  </React.StrictMode>
);
