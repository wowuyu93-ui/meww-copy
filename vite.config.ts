import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  // IMPORTANT: Change this to match your GitHub repository name
  // If your repo is https://github.com/wowuyu93-ui/mewphone
  // Then the base must be '/mewphone/'
  base: '/mewphone/', 
});