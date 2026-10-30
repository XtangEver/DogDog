import React from "react";
import { createRoot } from "react-dom/client";
import { ChatApp } from "./ChatApp";
import "./style.css";
import "./chat.css";
createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ChatApp />
  </React.StrictMode>,
);
