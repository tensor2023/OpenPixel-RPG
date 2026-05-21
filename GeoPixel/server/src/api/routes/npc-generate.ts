import { Router } from "express";
import type { Request, Response } from "express";
import { z } from "zod";
import { appContext } from "../../services/app-context.js";
import { LLMClient } from "../../llm/llm-client.js";
import { generateId } from "../../utils/id-generator.js";
import type { CharacterProfile, CharacterState } from "../../types/index.js";
import fs from "node:fs";
import path from "node:path";

let _npcClient: LLMClient | null = null;
function getNpcClient(): LLMClient {
  if (!_npcClient) {
    const url = process.env.NPC_BASE_URL;
    const key = process.env.NPC_API_KEY;
    _npcClient = url && key
      ? new LLMClient({ provider: "openai-compatible", baseURL: url, apiKey: key, defaultModel: process.env.NPC_GENERATE_MODEL ?? "deepseek-chat" })
      : appContext.llmClient;
  }
  return _npcClient;
}

/**
 * NPC 动态生成
 * 
 * 支持两种模式：
 * - random: 输入地点名，LLM 随机生成 5 个与该地点相关的 NPC
 * - custom: 输入地点名 + 名字 + 身份/角色，生成 1 个自定义 NPC
 * 
 * 生成的 NPC 加入 CharacterManager 的动态角色池，可在前端角色列表和地图上显示。
 */

const NpcGenerateRequest = z.object({
  locationName: z.string().min(1, "地点名不能为空"),
  mode: z.enum(["random", "custom"]),
  name: z.string().optional(),
  role: z.string().optional(),
});

const NpcProfileSchema = z.object({
  npcs: z.array(z.object({
    name: z.string(),
    role: z.string(),
    backstory: z.string(),
    coreMotivation: z.string(),
    speakingStyle: z.string(),
    coreValues: z.array(z.string()),
    fears: z.array(z.string()),
    preferredActivities: z.array(z.string()),
    socialStyle: z.enum(["extrovert", "introvert_selective", "introvert"]),
    personality: z.string(),
  })),
});

function saveNpcProfileToDisk(profile: CharacterProfile): void {
  const worldDir = appContext.getWorldDir();
  if (!worldDir) return;
  const npcsDir = path.join(worldDir, "npcs");
  fs.mkdirSync(npcsDir, { recursive: true });
  fs.writeFileSync(path.join(npcsDir, `${profile.id}.json`), JSON.stringify(profile, null, 2));
}

function deleteNpcProfileFromDisk(charId: string): void {
  const worldDir = appContext.getWorldDir();
  if (!worldDir) return;
  const filePath = path.join(worldDir, "npcs", `${charId}.json`);
  if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
}

function listPersistedNpcIds(): string[] {
  const worldDir = appContext.getWorldDir();
  if (!worldDir) return [];
  const npcsDir = path.join(worldDir, "npcs");
  if (!fs.existsSync(npcsDir)) return [];
  return fs.readdirSync(npcsDir)
    .filter((f) => f.endsWith(".json"))
    .map((f) => f.replace(/\.json$/, ""));
}

export { saveNpcProfileToDisk, deleteNpcProfileFromDisk, listPersistedNpcIds };

const router = Router();

// ── NPC 名称缓存（按地点，最多 10 条） ──

interface CachedNpcInfo {
  name: string;
  role: string;
  backstory: string;
  coreMotivation: string;
  speakingStyle: string;
  coreValues: string[];
  fears: string[];
  preferredActivities: string[];
  socialStyle: "extrovert" | "introvert_selective" | "introvert";
  personality: string;
}

const NPC_NAME_CACHE = new Map<string, CachedNpcInfo[]>();
const MAX_CACHE_PER_LOCATION = 10;

function getActiveNamesForLocation(locationName: string): Set<string> {
  const profiles = appContext.characterManager.getAllProfiles();
  const active = new Set<string>();
  for (const p of profiles) {
    if (p.preferredLocations?.includes(locationName) || p.tags?.includes(`location:${locationName}`)) {
      active.add(p.name);
    }
  }
  return active;
}

// ── 预置外观池 ────────────────────────────────────────────────────────────────

interface AppearanceEntry {
  id: string;        // e.g. "app_npc_woman1"
  label: string;     // human-readable category
  gender: "male" | "female" | "child_boy" | "child_girl";
  ageGroup: "young" | "middle" | "elderly" | "child";
  style: string[];   // descriptive keywords
}

const APPEARANCE_POOL: AppearanceEntry[] = [
  { id: "app_npc_woman1",  label: "年轻休闲女性", gender: "female",     ageGroup: "young",   style: ["阳光","温暖","休闲","友善"] },
  { id: "app_npc_woman2",  label: "优雅女性",     gender: "female",     ageGroup: "young",   style: ["优雅","温柔","端庄","斯文"] },
  { id: "app_npc_woman3",  label: "酷帅女性",     gender: "female",     ageGroup: "young",   style: ["潮流","酷","自信","前卫"] },
  { id: "app_npc_man1",    label: "休闲男性",     gender: "male",       ageGroup: "young",   style: ["友善","随和","休闲","温暖"] },
  { id: "app_npc_man2",    label: "斯文男性",     gender: "male",       ageGroup: "young",   style: ["斯文","聪明","整洁","专业"] },
  { id: "app_npc_man3",    label: "运动男性",     gender: "male",       ageGroup: "young",   style: ["运动","活力","激情","阳光"] },
  { id: "app_npc_girl",    label: "小女孩",       gender: "child_girl", ageGroup: "child",   style: ["天真","活泼","可爱","快乐"] },
  { id: "app_npc_boy",     label: "小男孩",       gender: "child_boy",  ageGroup: "child",   style: ["活泼","调皮","精力旺盛","可爱"] },
  { id: "app_npc_oldman1", label: "老年学者",     gender: "male",       ageGroup: "elderly", style: ["智慧","慈祥","学者","温和"] },
  { id: "app_npc_oldman2", label: "老年开朗",     gender: "male",       ageGroup: "elderly", style: ["开朗","热情","乐天","慈祥"] },
  { id: "app_npc_oldwoman1", label: "老年典雅女性", gender: "female",   ageGroup: "elderly", style: ["优雅","传统","端庄","安详"] },
  { id: "app_npc_oldwoman2", label: "老年热心女性", gender: "female",   ageGroup: "elderly", style: ["热心","温暖","开朗","慈祥"] },
];

export function getAllAppearanceIds(): string[] {
  return APPEARANCE_POOL.map(a => a.id);
}

function matchAppearance(role: string, name: string, personality: string, excludeIds?: Set<string>): string {
  const text = `${role} ${personality} ${name}`;
  const lower = text.toLowerCase();

  // ── Name-based gender hints (Chinese names) ──
  const femaleNameChars = /[静|美|丽|芳|娟|莉|婷|娜|霞|琳|玲|燕|华|雪|梅|兰|红|秀|芬|香|琴|雅|怡|慧|倩]|子$/;
  const maleNameChars = /[伟|强|明|军|勇|磊|国|志|建|平|斌|杰|飞|超|文|华|海|龙|鑫|浩|凯|豪|峰|涛|宇|宏|成|永|荣|光|胜|利|德]|生$/;
  const nameIsFemale = femaleNameChars.test(name);
  const nameIsMale = maleNameChars.test(name);

  // ── English name gender hints ──
  const englishFemaleNames = /^(maria|gina|karen|lisa|anna|emma|olivia|ava|sophia|isabella|mia|charlotte|amelia|harper|evelyn|abby|jessica|ashley|sarah|jennifer|alice|diana|helen|lucy|mary|susan|nancy|betty|linda|elizabeth|amanda|julia|victoria|stella|ella|grace|chloe|samantha|katherine|lauren|rachel|andrea|tiffany|eleanor|lena|fatima|evelyn|diane|marie|rose|jane|anne|violet|hannah|sara|megan|erin|amber|christina|kimberly|danielle|tammy|deborah|sharon|angela|catherine|rebecca|janet|wendy|alison|heather|kathy|donna|michelle|carol|joanne|kelly|tracey|gina)/i;
  const englishMaleNames = /^(harold|derek|samir|james|john|robert|michael|william|david|richard|joseph|thomas|charles|christopher|daniel|matthew|anthony|mark|donald|steven|paul|andrew|joshua|kenneth|kevin|brian|george|edward|ronald|timothy|jason|jeffrey|ryan|jacob|gary|nicholas|eric|jonathan|stephen|larry|justin|scott|brandon|benjamin|samuel|raymond|gregory|frank|alexander|patrick|jack|dennis|jerry|tyler|aaron|jose|nathan|henry|douglas|peter|adam|zachary|walter|kyle|carl|gerald|arthur|boris|vladimir|mike|marcus|jordan|jordan|jasper|ray|roy|wayne|louis|jeremy|albert|ernest|craig|sean|philip|danny|russell|alan|bruce|terry|bill|joe|tom|dick|harry|martin|leonard|norman|allen|marvin|melvin|lester|lewis|calvin|eddie|duane|earl|gene|vince|cliff|troy|guy|jim|dean|neil|brett|kurt|dean|chad|brad|greg|glen|brent|karl|kirk|warren|iván|juan|carlos|miguel|jorge|pedro|antonio|jose|mohammed|ali|ahmed|omar|hassan|hussein)/i;
  const nameIsEnglishFemale = englishFemaleNames.test(name);
  const nameIsEnglishMale = englishMaleNames.test(name);

  // ── English name suffix heuristics (for names not in explicit lists) ──
  const firstName = name.split(/[\s-]+/)[0];
  const nameEndsFemale = /[aeiou]a$|ia$|ie$|ette$|ine$|elle$|leen$|rose$|mary$/i.test(firstName) || /a$/.test(firstName);
  const nameEndsMale = /o$|er$|son$|man$|us$|bert$|ford$|ford$|wick$|burg$|ton$|ley$/.test(firstName);
  const hasFirstNameFemale = nameEndsFemale && !nameEndsMale;
  const hasFirstNameMale = nameEndsMale && !nameEndsFemale;

  // ── English role gender hints ──
  const roleFemaleKeywords = /\b(waitress|actress|tour\s*guide|nun|queen|princess|lady|madam|miss|ms\.|goddess|bridesmaid|hostess|stewardess|housemaid|nanny|midwife|dancer|sorority|witch|fairy|heroine|gymnast|cheerleader)\b/i;
  const roleMaleKeywords = /\b(guard|policeman|waiter|actor|king|prince|sir|mr\.|god|groomsman|host|steward|fireman|postman|doorman|handyman|wizard|hero|wrestler|boxer|lineman|cowboy)\b/i;

  // Age-based matching
  const isElderly = /退休|资深|年长|爷爷|奶奶|老年/.test(text) || /\b(retired|senior|elderly)\b/.test(lower);
  const isChild = /小|孩童|儿童|孩子|小学生/.test(text) || /\b(kid|child|schoolgirl|schoolboy)\b/.test(lower);
  const isStudent = (/学生|同学/.test(text) || /\b(student|intern|trainee|apprentice|pupil)\b/.test(lower)) && !isElderly;

  // Gender hints from role/personality (Chinese + English)
  const roleIsFemale = /女|阿姨|奶奶|女士|小姐|老板娘/.test(text) || roleFemaleKeywords.test(text);
  const roleIsMale = /男|爷爷|大伯|叔|保安|师傅|大爷/.test(text) || roleMaleKeywords.test(text);
  const isFemale = roleIsFemale || (nameIsFemale && !roleIsMale) || (nameIsEnglishFemale && !roleIsMale && !nameIsEnglishMale) || (hasFirstNameFemale && !roleIsMale && !nameIsEnglishMale);
  const isMale = roleIsMale || (nameIsMale && !roleIsFemale) || (nameIsEnglishMale && !roleIsFemale && !nameIsEnglishFemale) || (hasFirstNameMale && !roleIsFemale && !nameIsEnglishFemale);

  // Style hints (Chinese + English)
  const isScholarly = /教授|老师|学者|研究|博士|导师|研究员/.test(text) || /\b(professor|teacher|scholar|researcher|doctor|lecturer|scientist|engineer|consultant|analyst|programmer|technician|architect)\b/.test(lower);
  const isEnergetic = (/运动|活力|跑步|健身|教练|体育/.test(text) || /\b(coach|trainer|athlete|runner|fitness|sports|gym)\b/.test(lower)) && !isScholarly;
  const isElegant = /优雅|端庄|斯文|经理|主管|精英|白领/.test(text) || /\b(manager|director|executive|consultant|banker|lawyer|judge|ceo)\b/.test(lower);
  const isCasual = /休闲|自由|学生|同学/.test(text) || /\b(student|artist|writer|musician|freelancer|intern)\b/.test(lower);
  const isWarm = /热心|温暖|开朗|阿姨|厨师|老板|老板娘|服务|管理员/.test(text) || /\b(cook|chef|waiter|waitress|bartender|host|nurse|guide|counselor|volunteer|receptionist|attendant)\b/.test(lower);
  const isCool = /酷|前卫|潮流|叛逆|艺术|设计|画师/.test(text) || /\b(artist|designer|musician|dj|rebel|tattoo|street|skate)\b/.test(lower);

  // Score each appearance, building ranked list
  const scored = APPEARANCE_POOL.map((app) => {
    let score = 0;

    // Gender match (30pts)
    if (app.gender === "female" && isFemale) score += 30;
    if (app.gender === "male" && isMale) score += 30;
    // Gender mismatch penalty
    if (app.gender === "female" && isMale) score -= 20;
    if (app.gender === "male" && isFemale) score -= 20;

    // Age match (40pts)
    if (app.ageGroup === "elderly" && isElderly) score += 40;
    if (app.ageGroup === "child" && isChild) score += 40;
    if (app.ageGroup === "young" && isStudent && !isElderly) score += 20;
    if (app.ageGroup === "young" && !isStudent && !isElderly && !isChild) score += 5;

    // Style match
    if (isScholarly && app.style.includes("学者")) score += 30;
    if (isEnergetic && app.style.includes("运动")) score += 30;
    if (isElegant && (app.style.includes("优雅") || app.style.includes("斯文") || app.style.includes("端庄"))) score += 25;
    if (isCasual && (app.style.includes("休闲") || app.style.includes("随和") || app.style.includes("友善"))) score += 15;
    if (isWarm && (app.style.includes("热心") || app.style.includes("开朗") || app.style.includes("温暖") || app.style.includes("热情"))) score += 20;
    if (isCool && (app.style.includes("潮流") || app.style.includes("酷"))) score += 25;

    // Role keyword direct matching
    if (app.label && text.includes(app.label.slice(0, 2))) score += 20;

    return { id: app.id, score };
  });

  // Sort descending by score
  scored.sort((a, b) => b.score - a.score);

  // Pick the best that is not in excludeIds (if provided)
  if (excludeIds && excludeIds.size > 0) {
    for (const candidate of scored) {
      if (!excludeIds.has(candidate.id)) {
        return candidate.id;
      }
    }
  }

  return scored[0].id;
}

router.post("/generate", async (req: Request, res: Response) => {
  const parsed = NpcGenerateRequest.safeParse(req.body ?? {});
  if (!parsed.success) {
    return res.status(400).json({ 
      error: "Invalid request", 
      details: parsed.error.issues 
    });
  }

  const { locationName, mode, name, role } = parsed.data;

  if (mode === "custom" && (!name || !role)) {
    return res.status(400).json({ 
      error: "自定义模式需要提供 name 和 role（名字和身份）" 
    });
  }

  try {
    if (mode === "random") {
      const npcs = await generateRandomNpcs(locationName);
      return res.json({ ok: true, npcs, mode: "random" });
    } else {
      const npc = await generateCustomNpc(locationName, name!, role!);
      return res.json({ ok: true, npcs: [npc], mode: "custom" });
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[NPC Generate] Failed:", msg);
    return res.status(500).json({ error: `NPC 生成失败: ${msg}` });
  }
});

async function generateRandomNpcs(locationName: string): Promise<Array<{
  id: string;
  name: string;
  role: string;
  location: string;
  appearanceId: string;
  backstory: string;
  coreMotivation: string;
  speakingStyle: string;
  personality: string;
  socialStyle: string;
  coreValues: string[];
  fears: string[];
  preferredActivities: string[];
}>> {
  const worldName = appContext.worldManager.getWorldName();
  const worldDesc = appContext.worldManager.getWorldDescription();
  const lang = appContext.worldManager.getContentLanguage();
  const location = appContext.worldManager.getLocation(locationName);

  const locationDesc = location
    ? `${location.name}：${location.description}`
    : `${locationName}（世界中的一个地点）`;

  const targetCount = 5;

  // ── Step 1: 从缓存中取可用的 NPC ──
  const activeNames = getActiveNamesForLocation(locationName);
  const cached = NPC_NAME_CACHE.get(locationName) ?? [];
  const available = cached.filter((c) => !activeNames.has(c.name));

  // 按缓存顺序取，最多 targetCount 个（不从缓存中移除，下次靠 activeNames 去重）
  const reused = available.slice(0, targetCount);
  const needCount = targetCount - reused.length;

  // ── Step 2: 不足的部分由 LLM 生成 ──
  let generated: typeof reused = [];

  if (needCount > 0) {
    const prompt = buildRandomNpcPrompt(worldName, worldDesc, locationDesc, locationName, needCount, lang);
    const messages = [{ role: "user" as const, content: prompt }];
    const result = await getNpcClient().call({
      messages,
      schema: NpcProfileSchema,
      options: { taskType: "npc_generate" },
    });

    generated = result.data.npcs.map((npc) => ({
      name: npc.name,
      role: npc.role,
      backstory: npc.backstory,
      coreMotivation: npc.coreMotivation,
      speakingStyle: npc.speakingStyle,
      coreValues: npc.coreValues,
      fears: npc.fears,
      preferredActivities: npc.preferredActivities,
      socialStyle: npc.socialStyle,
      personality: npc.personality,
    }));
  }

  // ── Step 3: 合并并创建 NPC（多样化外观） ──
  const allNpcs = [...reused, ...generated];
  const npcs: Array<{ id: string; name: string; role: string; location: string; appearanceId: string; backstory: string; coreMotivation: string; speakingStyle: string; personality: string; socialStyle: string; coreValues: string[]; fears: string[]; preferredActivities: string[] }> = [];
  const usedAppearanceIds = new Set<string>();

  for (const npc of allNpcs) {
    const charId = generateId();
    const appearanceId = matchAppearance(npc.role, npc.name, npc.personality, usedAppearanceIds);
    usedAppearanceIds.add(appearanceId);
    const profile: CharacterProfile = {
      id: charId,
      name: npc.name,
      role: npc.role,
      nickname: npc.name,
      startPosition: "main_area",
      backstory: npc.backstory,
      coreMotivation: npc.coreMotivation,
      coreValues: npc.coreValues,
      speakingStyle: npc.speakingStyle,
      fears: npc.fears,
      preferredLocations: [locationName],
      preferredActivities: npc.preferredActivities,
      socialStyle: npc.socialStyle,
      extraversionLevel: npc.socialStyle === "extrovert" ? 0.8 : npc.socialStyle === "introvert_selective" ? 0.55 : 0.25,
      intuitionLevel: 0.6,
      skills: [],
      writeDiary: false,
      fourthWallCandidate: false,
      tags: ["dynamically_generated", `location:${locationName}`],
      initialMemories: [],
      appearanceId,
    };

    const state: CharacterState = {
      characterId: charId,
      location: "main_area",
      mainAreaPointId: null,
      currentAction: null,
      currentActionTarget: null,
      actionStartTick: 0,
      actionEndTick: 0,
      emotionValence: 1,
      emotionArousal: 3,
      curiosity: 70,
      dailyPlan: null,
    };

    appContext.characterManager.addDynamicCharacter(profile, state);
    saveNpcProfileToDisk(profile);

    npcs.push({
      id: charId,
      name: npc.name,
      role: npc.role,
      location: "main_area",
      appearanceId: profile.appearanceId!,
      backstory: npc.backstory,
      coreMotivation: npc.coreMotivation,
      speakingStyle: npc.speakingStyle,
      personality: npc.personality,
      socialStyle: npc.socialStyle,
      coreValues: npc.coreValues,
      fears: npc.fears,
      preferredActivities: npc.preferredActivities,
    });
  }

  // ── Step 4: 新生成的 NPC 加入缓存（合并 + 去重 + 限制 10 条） ──
  const existing = NPC_NAME_CACHE.get(locationName) ?? [];
  const merged = [...existing, ...generated];
  const seen = new Set<string>();
  const deduped = merged.filter((c) => {
    if (seen.has(c.name)) return false;
    seen.add(c.name);
    return true;
  });
  NPC_NAME_CACHE.set(locationName, deduped.slice(-MAX_CACHE_PER_LOCATION));

  return npcs;
}

async function generateCustomNpc(
  locationName: string,
  name: string,
  role: string,
): Promise<{ id: string; name: string; role: string; location: string; appearanceId: string; backstory: string; coreMotivation: string; speakingStyle: string; personality: string; socialStyle: string; coreValues: string[]; fears: string[]; preferredActivities: string[] }> {
  const worldName = appContext.worldManager.getWorldName();
  const lang = appContext.worldManager.getContentLanguage();
  const location = appContext.worldManager.getLocation(locationName);
  const locationDesc = location
    ? `${location.name}：${location.description}`
    : `${locationName}（世界中的一个地点）`;

  const prompt = buildCustomNpcPrompt(worldName, locationDesc, locationName, name, role, lang);

  const messages = [{ role: "user" as const, content: prompt }];

  const result = await getNpcClient().call({
    messages,
    schema: NpcProfileSchema,
    options: { taskType: "npc_generate" },
  });

  const npc = result.data.npcs[0];
  if (!npc) throw new Error("LLM 未返回 NPC 数据");

  const charId = generateId();
  const profile: CharacterProfile = {
    id: charId,
    name: npc.name,
    role: npc.role,
    nickname: npc.name,
    startPosition: "main_area",
    backstory: npc.backstory || `${npc.name}是${locationName}的${npc.role}`,
    coreMotivation: npc.coreMotivation || `在${locationName}过好自己的生活`,
    coreValues: npc.coreValues || [],
    speakingStyle: npc.speakingStyle || "自然、贴近角色设定",
    fears: npc.fears || [],
    preferredLocations: [locationName],
    preferredActivities: npc.preferredActivities || [],
    socialStyle: npc.socialStyle || "extrovert",
    extraversionLevel: npc.socialStyle === "extrovert" ? 0.8 : npc.socialStyle === "introvert_selective" ? 0.55 : 0.25,
    intuitionLevel: 0.6,
    skills: [],
    writeDiary: false,
    fourthWallCandidate: false,
    tags: ["dynamically_generated", `location:${locationName}`],
    initialMemories: [],
    appearanceId: matchAppearance(npc.role, npc.name, npc.personality || ""),
  };

  const state: CharacterState = {
    characterId: charId,
    location: "main_area",
    mainAreaPointId: null,
    currentAction: null,
    currentActionTarget: null,
    actionStartTick: 0,
    actionEndTick: 0,
    emotionValence: 1,
    emotionArousal: 3,
    curiosity: 70,
    dailyPlan: null,
  };

  appContext.characterManager.addDynamicCharacter(profile, state);
  saveNpcProfileToDisk(profile);

  return {
    id: charId,
    name: npc.name,
    role: npc.role,
    location: "main_area",
    appearanceId: profile.appearanceId!,
    backstory: npc.backstory,
    coreMotivation: npc.coreMotivation,
    speakingStyle: npc.speakingStyle,
    personality: npc.personality,
    socialStyle: npc.socialStyle,
    coreValues: npc.coreValues,
    fears: npc.fears,
    preferredActivities: npc.preferredActivities,
  };
}

function getLanguageName(code: string): string {
  const lang = code.split("-")[0];
  const names: Record<string, string> = {
    en: "English", fr: "French", de: "German", ja: "Japanese",
    ko: "Korean", it: "Italian", es: "Spanish", ru: "Russian",
    pt: "Portuguese", th: "Thai", hi: "Hindi",
  };
  return names[lang] || "English";
}

function buildRandomNpcPrompt(
  worldName: string,
  _worldDesc: string,
  locationDesc: string,
  locationName: string,
  count: number,
  locale: string,
): string {
  const lang = locale.split("-")[0];
  if (lang === "zh") {
    return `你是一个角色生成器。请为以下游戏世界的某个地点生成 ${count} 个 NPC。

世界名称：${worldName}
地点信息：${locationDesc}

要求：
1. 每个 NPC 的名字、身份/角色要与"${locationName}"这个地点高度相关
2. NPC 要有不同的性格和背景，涵盖不同社会角色（不要全是同一类型的人）
3. 背景故事要体现 TA 和这个地点的联系
4. 说话风格要贴合角色身份
5. 用中文生成，名字要像真实的中国名字

请严格按以下 JSON 格式输出，不要包含任何多余文字：
{
  "npcs": [
    {
      "name": "角色中文名",
      "role": "身份/职业",
      "backstory": "背景故事",
      "coreMotivation": "核心动机",
      "speakingStyle": "说话风格描述",
      "coreValues": ["价值观1", "价值观2"],
      "fears": ["恐惧1", "恐惧2"],
      "preferredActivities": ["偏好活动1", "偏好活动2"],
      "socialStyle": "extrovert 或 introvert_selective 或 introvert",
      "personality": "性格描述"
    }
  ]
}

请生成 ${count} 个 NPC，填入对应数组元素。`;
  }

  const language = getLanguageName(locale);
  return `You are a character generator. Generate ${count} NPCs for a specific location in a game world.

World: ${worldName}
Location: ${locationDesc}

Requirements:
1. Each NPC's name, role/identity must be highly relevant to "${locationName}"
2. NPCs should have diverse personalities and backgrounds, covering different social roles
3. Backstory should reflect their connection to this location
4. Speaking style should fit the character's identity
5. Generate in ${language}. Names must be culturally appropriate for a ${language}-speaking context.

Output strictly in the following JSON format with no extra text:
{
  "npcs": [
    {
      "name": "character name",
      "role": "role/occupation",
      "backstory": "backstory text",
      "coreMotivation": "core motivation",
      "speakingStyle": "description of speaking style",
      "coreValues": ["value1", "value2"],
      "fears": ["fear1", "fear2"],
      "preferredActivities": ["activity1", "activity2"],
      "socialStyle": "extrovert or introvert_selective or introvert",
      "personality": "personality description"
    }
  ]
}

Generate ${count} NPCs in the array.`;
}

function buildCustomNpcPrompt(
  worldName: string,
  locationDesc: string,
  locationName: string,
  name: string,
  role: string,
  locale: string,
): string {
  const lang = locale.split("-")[0];
  if (lang === "zh") {
    return `你是一个角色生成器。请为以下游戏世界的角色完善人设。

世界名称：${worldName}
地点信息：${locationDesc}
角色名字：${name}
角色身份：${role}

要求：
1. 背景故事要体现 TA 和"${locationName}"这个地点的联系
2. 核心动机要符合 TA 作为"${role}"在这个地点的身份
3. 说话风格要贴合角色身份
4. 偏好活动要和地点相关
5. 用中文生成

请严格按以下 JSON 格式输出，不要包含任何多余文字：
{
  "npcs": [
    {
      "name": "${name}",
      "role": "${role}",
      "backstory": "背景故事",
      "coreMotivation": "核心动机",
      "speakingStyle": "说话风格描述",
      "coreValues": ["价值观1", "价值观2"],
      "fears": ["恐惧1", "恐惧2"],
      "preferredActivities": ["偏好活动1", "偏好活动2"],
      "socialStyle": "extrovert 或 introvert_selective 或 introvert",
      "personality": "性格描述"
    }
  ]
}

请生成 1 个 NPC，填入数组。`;
  }

  const language = getLanguageName(locale);
  return `You are a character generator. Complete the profile for a specific character in a game world.

World: ${worldName}
Location: ${locationDesc}
Character Name: ${name}
Character Role: ${role}

Requirements:
1. Backstory should reflect their connection to "${locationName}"
2. Core motivation should fit their identity as "${role}" at this location
3. Speaking style should fit the character
4. Preferred activities should be location-relevant
5. Generate in ${language}. Names must be culturally appropriate for a ${language}-speaking context.

Output strictly in the following JSON format with no extra text:
{
  "npcs": [
    {
      "name": "${name}",
      "role": "${role}",
      "backstory": "backstory text",
      "coreMotivation": "core motivation",
      "speakingStyle": "description of speaking style",
      "coreValues": ["value1", "value2"],
      "fears": ["fear1", "fear2"],
      "preferredActivities": ["activity1", "activity2"],
      "socialStyle": "extrovert or introvert_selective or introvert",
      "personality": "personality description"
    }
  ]
}

Generate 1 NPC in the array.`;
}

export default router;
