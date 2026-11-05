import React from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import './styles.css';
import './workspace.css';
import './charts.css';
import './gantt.css';
import './card-actions.css';
import './dialogs.css';

createRoot(document.getElementById('root')!).render(<React.StrictMode><App /></React.StrictMode>);
