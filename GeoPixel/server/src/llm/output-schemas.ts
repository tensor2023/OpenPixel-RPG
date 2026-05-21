import { z } from "zod";

/** 4.1 响应式决策输出 */
export const ActionDecisionSchema = z.object({
  actionType: z.enum([
    "interact_object",
    "world_action",
    "talk_to",
    "move_to",
    "move_within_main_area",
    "idle",
  ]),
  targetId: z.string(),
  interactionId: z.string().optional(),
  reason: z.string().min(5),
  innerMonologue: z.string().optional(),
});

export type ActionDecisionOutput = z.infer<typeof ActionDecisionSchema>;

/** 4.2 对话生成输出 */
export const DialogueResultSchema = z.object({
  turns: z
    .array(
      z.object({
        speaker: z.string(),
        content: z.string().min(1),
      }),
    )
    .min(2)
    .max(10),
  memoriesGenerated: z.record(z.string(), z.string()),
  tags: z.array(z.string()),
});

export type DialogueResultOutput = z.infer<typeof DialogueResultSchema>;

/** 4.2a 单轮对话输出 */
export const DialogueTurnSchema = z.object({
  speaker: z.string(),
  content: z.string().min(1),
  innerMonologue: z.string().optional(),
  shouldContinue: z.boolean(),
  suggestedNextSpeaker: z.string().optional(),
  endReason: z.string().optional(),
  tags: z.array(z.string()).optional(),
});

export type DialogueTurnOutput = z.infer<typeof DialogueTurnSchema>;

/** 4.2b 对话收尾输出 */
export const DialogueFinalizeSchema = z.object({
  memoriesGenerated: z.record(z.string(), z.string()),
  tags: z.array(z.string()),
  endReason: z.string().optional(),
  hearsayGenerated: z.record(z.string(), z.string()).optional(),
});

export type DialogueFinalizeOutput = z.infer<typeof DialogueFinalizeSchema>;

/** 4.3 日记生成输出 */
export const DiarySchema = z.object({
  content: z.string().min(20),
  mood: z.string(),
  tags: z.array(z.string()),
});

export type DiaryOutput = z.infer<typeof DiarySchema>;

/** 4.4 记忆重要性评估（批量）输出 */
export const MemoryEvalSchema = z.object({
  evaluations: z.array(
    z.object({
      memoryId: z.string(),
      importance: z.number().min(1).max(10),
      emotionalValence: z.number().min(-5).max(5),
      emotionalIntensity: z.number().min(0).max(10),
      tags: z.array(z.string()),
    }),
  ),
});

export type MemoryEvalOutput = z.infer<typeof MemoryEvalSchema>;

/** 4.4a 轻量微反思输出 */
export const MicroReflectionSchema = z.object({
  insight: z.string().min(5).max(120),
  emotionShift: z.object({
    valence: z.number().min(-1).max(1),
    arousal: z.number().min(-1).max(1),
  }),
  currentFocus: z.string().min(5).max(100).optional(),
  tags: z.array(z.string()).optional(),
});

export type MicroReflectionOutput = z.infer<typeof MicroReflectionSchema>;

/** 4.5 反思输出 */
export const ReflectionSchema = z.object({
  insights: z
    .array(
      z.object({
        content: z.string().min(5),
        relatedMemoryIds: z.array(z.string()),
        importance: z.number().min(1).max(10),
        tags: z.array(z.string()),
      }),
    )
    .min(1)
    .max(5),
  emotionShift: z.object({
    valence: z.number().min(-3).max(3),
    arousal: z.number().min(-3).max(3),
  }),
  currentFocus: z.string().min(5).max(100).optional(),
});

export type ReflectionOutput = z.infer<typeof ReflectionSchema>;
