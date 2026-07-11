import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./globals.css";
// Inicializar el logger al inicio de la aplicación (solo importarlo es suficiente)
import "./utils/logger";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
