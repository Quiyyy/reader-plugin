import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { viteSingleFile } from 'vite-plugin-singlefile';
export default defineConfig({ plugins: [react(), viteSingleFile()], build: { outDir: 'dist/ui', emptyOutDir: true, target: 'es2022', cssCodeSplit: false }, server: { host: '127.0.0.1' } });
