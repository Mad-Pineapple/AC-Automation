import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";

// A tab left open across a deployment asks for chunk names that no longer
// exist; the SPA rewrite answers with index.html and the import fails. Reload
// once so the tab picks up the current build instead of failing an action.
window.addEventListener("vite:preloadError", (event) => {
  const key = "reloaded-for-preload-error";
  if (sessionStorage.getItem(key)) return;
  sessionStorage.setItem(key, "1");
  event.preventDefault();
  window.location.reload();
});
window.addEventListener("load", () => sessionStorage.removeItem("reloaded-for-preload-error"));

createRoot(document.getElementById("root")!).render(<App />);
