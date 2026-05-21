const WORLD_ACTION_TARGET_PREFIX = "world_action:";

const ACTION_LABELS: Record<string, string> = {
  sleep: "睡觉",
  cook: "做饭",
  eat: "吃饭",
  read: "阅读",
  read_bulletin: "看公告",
  write_diary: "写日记",
  talk: "聊天",
  talking: "聊天",
  in_conversation: "对话中",
  traveling: "移动中",
  idle: "发呆",
  fish: "钓鱼",
  explore: "探索",
  repair: "修理",
  think_in_bed: "躺床上思考",
  lock_door: "锁门",
  unlock_door: "开锁",
  people_watch: "闲坐观望",
  use_computer: "使用电脑",
  have_drink: "喝饮料",
  craft: "做手工",
  stroll: "散步",
  tend_garden: "打理花园",
  post_message: "张贴留言",
  move_within_main_area: "在主区域换位置",
  post_dialogue: "刚结束对话",
};

type WorldActionLike = { id: string; name: string };
type ObjectInteractionLike = { id: string; name: string };
type WorldObjectLike = { interactions?: ObjectInteractionLike[] };

export function resolveActionLabel(params: {
  actionId?: string | null;
  targetId?: string | null;
  locationId?: string | null;
  getWorldAction: (actionId: string) => WorldActionLike | undefined;
  getLocationObjects: (locationId: string) => WorldObjectLike[];
}): string | null {
  const actionId = params.actionId ?? null;
  if (!actionId) return null;

  if (params.targetId?.startsWith(WORLD_ACTION_TARGET_PREFIX)) {
    const worldActionId = params.targetId.slice(WORLD_ACTION_TARGET_PREFIX.length);
    return params.getWorldAction(worldActionId)?.name ?? ACTION_LABELS[actionId] ?? null;
  }

  const directWorldAction = params.getWorldAction(actionId);
  if (directWorldAction?.name) {
    return directWorldAction.name;
  }

  if (params.targetId && params.locationId) {
    const object = params
      .getLocationObjects(params.locationId)
      .find((candidate) =>
        candidate.interactions?.some((interaction) => interaction.id === actionId),
      );
    const interaction = object?.interactions?.find((candidate) => candidate.id === actionId);
    if (interaction?.name) {
      return interaction.name;
    }
  }

  return null;
}
