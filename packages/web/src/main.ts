import { mount } from "svelte";
import App from "./App.svelte";
import ImageViewer from "./components/ImageViewer.svelte";
import { start } from "./lib/state.svelte.ts";

start();
// Lets browsers offer "Install Squad" (its own window and dock icon). The worker caches nothing.
if (import.meta.env.PROD && "serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js").catch(() => {});
mount(App, { target: document.getElementById("app")! });
mount(ImageViewer, { target: document.body });
