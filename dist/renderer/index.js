"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const jsx_runtime_1 = require("react/jsx-runtime");
const client_1 = require("react-dom/client");
const App_1 = require("./App");
require("./styles/global.css");
const container = document.getElementById("root");
if (!container) {
    throw new Error("Root element not found");
}
const root = (0, client_1.createRoot)(container);
root.render((0, jsx_runtime_1.jsx)(App_1.App, {}));
