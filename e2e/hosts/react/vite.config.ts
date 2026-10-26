import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { hostBackend } from '../backend.mjs';

// The backend is a dev-time dependency only: `vite build` compiles this host
// with no wire server near it. Bringing one up eagerly would make the build need
// a listening socket.
export default defineConfig(async ({ command }) => ({
    plugins: [react()],
    optimizeDeps: {
        // Pre-built workspace ESM. Serve it as published rather than letting
        // the dep optimizer re-bundle the sources.
        exclude: ['@ezclassify/react', '@ezclassify/ui'],
        // The optimizer does not scan an excluded package, so a dependency
        // only it imports is found on the first page load, and optimizing it
        // then reloads the page under whatever was running. Name it here.
        include: ['@ezclassify/ui > @ezclassify/types'],
    },
    server: command === 'serve' ? { proxy: await hostBackend() } : {},
}));
