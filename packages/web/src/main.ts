import { mount } from "svelte";
import App from "./App.svelte";
import ImageViewer from "./components/ImageViewer.svelte";
import { start } from "./lib/state.svelte.ts";

start();
mount(App, { target: document.getElementById("app")! });
mount(ImageViewer, { target: document.body });
