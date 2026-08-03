import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./globals.css";
// Initialize the logger at app startup (importing it is enough)
import "./utils/logger";
import { bootstrapI18n } from "@/i18n";

// Resolve the language before the first render so the UI never flashes
// untranslated content
void bootstrapI18n().then(() => {
  ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  );
});
