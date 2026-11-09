// 画面の入口
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./app/App";
import "./styles/base.css";
import "./styles/layout.css";
import "./styles/chat.css";
import "./styles/evidence.css";

const root = document.getElementById("root");
if (!root) throw new Error("#root がありません");

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
