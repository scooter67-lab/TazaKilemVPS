import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import "./index.css";
import { App } from "./App";
import { TimezoneProvider } from "./TimezoneContext";
import { PwaUpdate } from "./PwaUpdate";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <BrowserRouter>
      <TimezoneProvider>
        <App />
      </TimezoneProvider>
    </BrowserRouter>
    <PwaUpdate />
  </React.StrictMode>
);
