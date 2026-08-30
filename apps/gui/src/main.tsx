import { createRoot } from "react-dom/client";
import { AppRoot } from "@vagus/web";

const container = document.getElementById("root");
if (!container) {
  throw new Error("missing #root element — index.html is malformed");
}

createRoot(container).render(<AppRoot />);