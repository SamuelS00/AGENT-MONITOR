import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  resolve: { dedupe: ["react", "react-dom"] },
  optimizeDeps: { include: ["@xyflow/react"] },
  server: { port: 1420, strictPort: true },
  envPrefix: ["VITE_", "TAURI_"]
});
