import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  root: "/Users/jugurthak/security/maltify/packages/web",
  plugins: [react(), tailwindcss()],
  server: { port: 5199, strictPort: true, proxy: { "/api": "http://localhost:8799" } },
});
