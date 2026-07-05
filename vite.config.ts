import { reactRouter } from "@react-router/dev/vite";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [tailwindcss(), reactRouter()],
  optimizeDeps: {
    // pre-bundle the heavy 3D deps so vite doesn't re-optimize (and force a
    // full page reload, wiping game state) when the game route first loads
    include: [
      "three",
      "@react-three/fiber",
      "@react-three/drei",
      "zustand",
      "@clerk/react-router",
    ],
  },
});
