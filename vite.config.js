import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import { viteSingleFile } from 'vite-plugin-singlefile';

// 两种构建模式：
//   npm run build          → 标准 dist/（多文件，可用任意静态服务器托管）
//   npm run build:single   → dist-single/index.html 单文件（双击即可离线打开，无需服务器）
//     —— 解决 file:// 协议下 ES module / 资源被 CORS 拦截导致的"打不开/无法观看"。
//        单文件模式把 JS/CSS 全部内联为 inline script/style，并把代码转为非 module 形式。
export default defineConfig(({ mode }) => {
  const single = mode === 'single';
  return {
    plugins: [vue(), ...(single ? [viteSingleFile({ removeViteModuleLoader: true })] : [])],
    // 单文件模式下 base 无所谓（资源已内联）；标准模式用相对 base 便于子路径部署
    base: './',
    server: { host: true, port: 5173 },
    build: {
      outDir: single ? 'dist-single' : 'dist',
      emptyOutDir: true,
      chunkSizeWarningLimit: single ? 8000 : 2000,
      // 单文件：禁用代码分割与资源外链，全部 inline
      cssCodeSplit: !single,
      assetsInlineLimit: single ? 100000000 : 4096,
      rollupOptions: single
        ? { output: { inlineDynamicImports: true } }
        : {},
    },
  };
});
