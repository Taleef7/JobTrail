// /label/: the owner's review of eval drafts (#71). See App.tsx.
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { LabelApp } from "./App";
import "../src/styles.css";
import "./label.css";

const root = document.getElementById("root");
if (!root) throw new Error("#root missing");
createRoot(root).render(
  <StrictMode>
    <LabelApp />
  </StrictMode>,
);
