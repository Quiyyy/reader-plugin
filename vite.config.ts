import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { inlineReaderUi } from './scripts/inline-ui.mjs';
export default defineConfig({ plugins: [react(), inlineReaderUi()], build: { outDir: 'dist/ui', emptyOutDir: true, target: 'es2022', cssCodeSplit: false }, server: { host: '127.0.0.1' } });
