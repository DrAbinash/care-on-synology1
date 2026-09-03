import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";

/**
 * Mount only on the Zero-Trace bootstrap page (#root[data-sa-bootstrap]).
 * Never call createRoot on the billing ERP #root — that hijacks / crashes the SPA
 * when an older ERP build injected this USB bundle as a blob script.
 * window.SuperAdminPortal is still assigned from App.tsx for embed-capable hosts.
 */
const rootEl = document.getElementById("root");
if (rootEl?.getAttribute("data-sa-bootstrap") === "1") {
  createRoot(rootEl).render(<App />);
}
