import { Router } from "express";
import * as contentStore from "../../store/content-store.js";

export function createPublicContentRouter(): Router {
  const router = Router();

  // GET /content/quotes
  router.get("/quotes", (_req, res) => {
    const candidates = contentStore.getCandidates({ type: "quote", limit: 50 });
    res.json(candidates);
  });

  // GET /content/summaries
  router.get("/summaries", (_req, res) => {
    const candidates = contentStore.getCandidates({ type: "summary", limit: 50 });
    res.json(candidates);
  });

  return router;
}
