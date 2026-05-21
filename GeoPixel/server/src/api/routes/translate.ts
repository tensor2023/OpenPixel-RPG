import { Router } from "express";
import type { Request, Response } from "express";
import { z } from "zod";
import { appContext } from "../../services/app-context.js";

const router = Router();

const TranslateRequest = z.object({
  text: z.string().min(1),
  sourceLocale: z.string().optional(),
  targetLocale: z.string().optional(),
});

router.post("/", async (req: Request, res: Response) => {
  const parsed = TranslateRequest.safeParse(req.body ?? {});
  if (!parsed.success) {
    return res.status(400).json({ ok: false, error: "Invalid request" });
  }

  const { text, targetLocale = "zh-CN" } = parsed.data;

  try {
    const result = await appContext.llmClient.call({
      messages: [
        {
          role: "user",
          content: `You are a translator. Translate the following text to Chinese (${targetLocale}). Return ONLY the translated text, no explanation, no extra formatting.\n\nText: ${text}\n\nTranslation:`,
        },
      ],
      schema: z.object({ translation: z.string() }),
      options: { taskType: "translate", temperature: 0.3 },
    });

    return res.json({ ok: true, translated: result.data.translation });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[Translate] Failed:", msg);
    return res.status(500).json({ ok: false, error: `Translation failed: ${msg}` });
  }
});

export default router;
