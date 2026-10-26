import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';
import { App } from './App';

const host = document.getElementById('root');
if (!host) throw new Error('the page is missing its #root element');

createRoot(host).render(
    <StrictMode>
        <App />
    </StrictMode>,
);
