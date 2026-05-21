export interface LLMConfig {
  provider: string;
  baseURL: string;
  apiKey: string;
  defaultModel: string;
  modelOverrides?: Record<string, string>;
}

export interface LLMCallOptions {
  taskType: string;
  characterId?: string;
  model?: string;
  temperature?: number;
  maxRetries?: number;
  timeoutMs?: number;
  structuredOutputMode?: "auto" | "json_object" | "prompt_only";
}

export interface LLMCallResult<T> {
  data: T;
  usage: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
  model: string;
  durationMs: number;
}

export interface LLMCallLog {
  id: string;
  taskType: string;
  characterId?: string;
  model: string;
  promptTokens: number;
  completionTokens: number;
  cost: number;
  durationMs: number;
  success: boolean;
  error?: string;
  createdAt: string;
}
