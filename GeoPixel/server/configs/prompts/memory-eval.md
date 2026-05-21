评估以下记忆条目的重要性和情感属性。

## 记忆列表
{{memoryList}}

## 评估标准
- importance（1-10）：对角色生活和决策的影响程度。日常琐事1-3，普通社交4-5，重要发现/情感事件6-8，改变人生的大事9-10
- emotionalValence（-5到+5）：情感色彩，负面到正面
- emotionalIntensity（0-10）：情感强度
- tags：给每条记忆打上标签（可选：anomaly, romance, conflict, discovery, daily, social, mystery, fear, joy, trust, betrayal）

输出JSON：
```json
{
  "evaluations": [
    { "memoryId": "id", "importance": 5, "emotionalValence": 2, "emotionalIntensity": 3, "tags": ["social"] }
  ]
}
```
