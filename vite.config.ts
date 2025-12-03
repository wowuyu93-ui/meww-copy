import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  // 如果是部署到 Netlify，通常使用根路径 '/'
  // 如果是部署到 GitHub Pages (https://user.github.io/repo/)，则保持 '/repo-name/'
  // 为了兼容性，这里改为 './' (相对路径)，这样在大多数地方都能跑
  base: './', 
});