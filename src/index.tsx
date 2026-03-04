import React from "react";
import ReactDOM from "react-dom/client";

import { ErrorBoundary } from "./components/ErrorBoundary";
import { RouterProvider } from "./components/Router";
import * as serviceWorkerRegistration from "./serviceWorkerRegistration";
import "./translations";

const rootEl = document.getElementById("root");
if (!rootEl) throw new Error("Root element #root not found");

const root = ReactDOM.createRoot(rootEl);

root.render(
  <React.StrictMode>
    <ErrorBoundary>
      <RouterProvider />
    </ErrorBoundary>
  </React.StrictMode>,
);

serviceWorkerRegistration.register();
