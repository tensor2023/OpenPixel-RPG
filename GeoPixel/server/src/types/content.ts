export interface ContentCandidate {
  id: string;
  eventId: string;
  type: "highlight" | "quote" | "summary";
  dramScore: number;
  content: string;
  characterId?: string;
  context?: string;
  tags: string[];
  reviewed: boolean;
}
