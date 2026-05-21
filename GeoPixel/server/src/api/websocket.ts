import type { Server as HttpServer } from "node:http";
import { WebSocketServer, WebSocket } from "ws";
import type { AppContext } from "../services/app-context.js";

export function setupWebSocket(server: HttpServer, ctx: AppContext): WebSocketServer {
  const wss = new WebSocketServer({ server });

  function broadcast(data: unknown): void {
    const msg = JSON.stringify(data);
    for (const client of wss.clients) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(msg);
      }
    }
  }

  ctx.eventBus.on("tick_events", ({ gameTime, events }) => {
    broadcast({
      type: "simulation_events",
      data: { gameTime, events },
    });

    const highlights = events.filter(
      (e: any) => e.dramScore !== undefined && e.dramScore >= 6,
    );
    for (const h of highlights) {
      broadcast({
        type: "highlight_detected",
        data: h,
      });
    }
  });

  ctx.eventBus.on("simulation_status", (payload) => {
    broadcast({
      type: "simulation_status",
      data: payload,
    });
  });

  wss.on("connection", (ws) => {
    const gameTime = ctx.worldManager.getCurrentTime();
    ws.send(
      JSON.stringify({
        type: "connected",
        data: { gameTime },
      }),
    );
  });

  return wss;
}
