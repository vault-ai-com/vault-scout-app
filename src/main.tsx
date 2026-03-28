import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";

// Handle stale chunks after deploy
window.addEventListener('vite:preloadError', () => {
  const key = 'vite_preload_reload';
  if (!sessionStorage.getItem(key)) {
    sessionStorage.setItem(key, '1');
    window.location.reload();
  } else {
    sessionStorage.removeItem(key);
  }
});

createRoot(document.getElementById("root")!).render(<App />);
