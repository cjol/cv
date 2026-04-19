import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  build: {
    outDir: "dist",
    rollupOptions: {
      input: "index.html",
    },
  },
  server: {
    proxy: {
      "/api": "http://localhost:8787",
      "/agents": {
        target: "http://localhost:8787",
        ws: true,
      },
    },
  },
});
