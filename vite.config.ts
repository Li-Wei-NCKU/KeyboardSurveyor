import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';

// build 產出單一 HTML（所有 JS/CSS 內嵌），雙擊即可在瀏覽器遊玩，也方便分享
export default defineConfig({
  base: './',
  plugins: [viteSingleFile()],
  build: { target: 'es2022', chunkSizeWarningLimit: 4000 },
});
