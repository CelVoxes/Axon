"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const electron_1 = require("electron");
// Expose protected methods that allow the renderer process to use
// the ipcRenderer without exposing the entire object
electron_1.contextBridge.exposeInMainWorld("electronAPI", {
    // File system operations
    readFile: (filePath) => electron_1.ipcRenderer.invoke("fs-read-file", filePath),
    writeFile: (filePath, content) => electron_1.ipcRenderer.invoke("fs-write-file", filePath, content),
    createDirectory: (dirPath) => electron_1.ipcRenderer.invoke("fs-create-directory", dirPath),
    listDirectory: (dirPath) => electron_1.ipcRenderer.invoke("fs-list-directory", dirPath),
    // Jupyter operations
    startJupyter: (workingDir) => electron_1.ipcRenderer.invoke("jupyter-start", workingDir),
    stopJupyter: () => electron_1.ipcRenderer.invoke("jupyter-stop"),
    checkJupyterStatus: () => electron_1.ipcRenderer.invoke("jupyter-status"),
    executeJupyterCode: (code) => electron_1.ipcRenderer.invoke("jupyter-execute", code),
    // Dialog operations
    showOpenDialog: (options) => electron_1.ipcRenderer.invoke("show-open-dialog", options),
    showSaveDialog: (options) => electron_1.ipcRenderer.invoke("show-save-dialog", options),
    // Store operations
    storeGet: (key) => electron_1.ipcRenderer.invoke("store-get", key),
    storeSet: (key, value) => electron_1.ipcRenderer.invoke("store-set", key, value),
    // BioRAG operations
    bioragQuery: (query) => electron_1.ipcRenderer.invoke("biorag-query", query),
    getBioragPort: () => electron_1.ipcRenderer.invoke("get-biorag-port"),
    getBioragUrl: () => electron_1.ipcRenderer.invoke("get-biorag-url"),
    // Event listeners
    onBioRAGLog: (callback) => {
        electron_1.ipcRenderer.on("biorag-log", (_, data) => callback(data));
    },
    onBioRAGError: (callback) => {
        electron_1.ipcRenderer.on("biorag-error", (_, data) => callback(data));
    },
    onBioRAGServerReady: (callback) => {
        electron_1.ipcRenderer.on("biorag-server-ready", (_, data) => callback(data));
    },
    onJupyterLog: (callback) => {
        electron_1.ipcRenderer.on("jupyter-log", (_, data) => callback(data));
    },
    onJupyterReady: (callback) => {
        electron_1.ipcRenderer.on("jupyter-ready", (_, data) => callback(data));
    },
    onJupyterError: (callback) => {
        electron_1.ipcRenderer.on("jupyter-error", (_, data) => callback(data));
    },
    // Workspace events
    onSetWorkspace: (callback) => {
        electron_1.ipcRenderer.on("set-workspace", (_, workspacePath) => callback(workspacePath));
    },
    onTriggerOpenWorkspace: (callback) => {
        electron_1.ipcRenderer.on("trigger-open-workspace", () => callback());
    },
    // Remove listeners
    removeAllListeners: (channel) => {
        electron_1.ipcRenderer.removeAllListeners(channel);
    },
});
