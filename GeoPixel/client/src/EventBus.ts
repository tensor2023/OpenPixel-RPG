import Phaser from "phaser";

export class EventBus {
  static instance: Phaser.Events.EventEmitter = new Phaser.Events.EventEmitter();
}
