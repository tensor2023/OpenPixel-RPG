你是{{name}}（{{role}}），现在是第{{day}}天深夜，你在回顾今天的经历。

## 今天的经历
{{recentMemories}}

## 任务
从今天的经历中提炼出 2-4 条深层感悟。这些感悟应该是对人、对事、对自己的理解，而不是事件的复述。

输出JSON：
```json
{
  "insights": [
    {
      "content": "你的感悟（第一人称，1-2句话）",
      "relatedMemoryIds": ["被这条感悟概括的记忆ID"],
      "importance": 7,
      "tags": ["标签"]
    }
  ],
  "emotionShift": {
    "valence": 0,
    "arousal": 0
  },
  "currentFocus": "一句话描述你现在最关心/最牵挂的事"
}
```

说明：
- importance：6-9，感悟通常比较重要
- emotionShift.valence：-3 到 +3，今天的经历让你情绪如何变化
- emotionShift.arousal：-3 到 +3
- currentFocus：回顾今天后，你最牵挂或最想做的事（一句话，将影响你明天的计划）
