import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  // relative base: the build works from any static host or sub-path (GitHub Pages, a file share…)
  base: './',
  plugins: [react()],
  build: {
    // elkjs is ~1.5 MB but only loaded the first time you click Arrange
    chunkSizeWarningLimit: 1600,
    rollupOptions: {
      output: {
        manualChunks: {
          flow: ['@xyflow/react'],
          codemirror: ['codemirror', '@codemirror/lang-sql', '@codemirror/lint', '@codemirror/view', '@codemirror/state', '@codemirror/language'],
          graph: ['graphology', 'graphology-communities-louvain', 'd3-force'],
        },
      },
    },
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
} as never);
