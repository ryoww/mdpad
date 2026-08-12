import "./styles.css";
import { AppController } from "./app-controller";
import { createFileGateway } from "./file-gateway";

const appRoot = document.querySelector<HTMLElement>("#app");

if (!appRoot) {
  throw new Error("mdpad のルート要素が見つかりません。");
}

const controller = new AppController(appRoot, createFileGateway());
void controller.start();
