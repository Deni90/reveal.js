import { resolve } from 'path';
import { defineConfig } from 'vite';
import { appendExtension } from '../../vite.config.ts';
import { createPluginDts } from '../vite-plugin-dts.ts';

export default defineConfig({
  build: {
    emptyOutDir: false,
    cssCodeSplit: false,
    lib: {
      formats: ['es', 'umd'],
      entry: {
        'plugin/code-editor': resolve(import.meta.dirname, 'index.ts'),
      },
      name: 'CodeEditor',
      fileName: appendExtension,
    },
    rollupOptions: {
      output: {
        assetFileNames: (assetInfo) => {
          if (assetInfo.names?.some((name) => name.endsWith('.css'))) {
            return 'plugin/code-editor.css';
          }

          return 'assets/[name]-[hash][extname]';
        },
      },
    },
  },
  plugins: [createPluginDts('code-editor')],
});
