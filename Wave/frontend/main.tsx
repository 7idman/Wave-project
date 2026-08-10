import React from "react";
import ReactDOM from "react-dom/client";
import App from "./PlatformApp";
import { ErrorBoundary } from "./components/ErrorBoundary";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ErrorBoundary boundaryName="app-root">
      <App />
    </ErrorBoundary>
  </React.StrictMode>
);
