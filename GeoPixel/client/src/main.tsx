import "./i18n";
import Phaser from "phaser";
import { createRoot } from "react-dom/client";
import { BootScene } from "./scenes/BootScene";
import { WorldScene } from "./scenes/WorldScene";
import { App } from "./ui/App";
import { EventBus } from "./EventBus";

const game = new Phaser.Game({
  type: Phaser.AUTO,
  width: window.innerWidth,
  height: window.innerHeight,
  parent: "game-root",
  transparent: true,
  render: { antialias: true, roundPixels: false },
  scale: { mode: Phaser.Scale.RESIZE },
  scene: [BootScene, WorldScene],
});

const uiRoot = document.getElementById("ui-root")!;
createRoot(uiRoot).render(<App eventBus={EventBus.instance} />);
