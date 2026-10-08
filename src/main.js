import { createApp } from 'vue';
import App from './App.vue';

// 等系统字体（PingFang SC / Microsoft YaHei 等）就绪后再挂载。
// 原因：ECharts 的 3D 标签依赖 canvas measureText 做换行计算；若字体尚未加载
// 完成，中文字符测量会退化，导致标签被逐字换行（视觉上"竖排"）——尤其在
// 录制/导出瞬间更容易触发。这里加一个软性守卫，最多等 1.5s，避免极端情况下卡死。
const ready = (typeof document !== 'undefined' && document.fonts && document.fonts.ready)
  ? Promise.race([document.fonts.ready, new Promise((r) => setTimeout(r, 1500))])
  : Promise.resolve();

ready.then(() => createApp(App).mount('#app'));
