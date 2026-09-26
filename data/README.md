# 数据格式

`corpus.json` 是页面唯一加载的词库。`schemaVersion` 为 1，`chapters` 为练习数组。

```json
{
  "id": "6.3",
  "chapter": 6,
  "title": "复数听写 · Cambridge 1",
  "source": "textbook-pdf",
  "pdfPages": [153, 154, 155, 156, 157],
  "audio": ["audio-066"],
  "words": [
    {"id": "6.3:1", "w": "accounts", "p": "", "m": "", "pdfPage": 153}
  ]
}
```

示例音频 ID 仅说明结构；维护时必须使用 `audio.json` 中对应练习的真实 ID。

- `id`：练习标识，与旧版章节和历史记录关联，不随意改名。`-sheet` 表示第 11 章配套答案表对照版本。
- `words`：按练习顺序保存；不要去重或排序，同一词语可在不同位置复现。
- `w`：标准答案；`p`：音标；`m`：中文释义。不确定的音标、释义留空。
- `answers`：可选，可接受的其他完整答案数组。只收录明确可接受的变体。
- `kind`：可选，`number`、`code`、`date`、`money`、`quantity`；决定格式归一化规则。普通词汇省略。
- `speech`：可选，逐词朗读的文本，例如用空格分开的电话号码数字。不影响标准答案。
- `pdfPage` / `pdfPages`：源 PDF 从 1 开始的页面序号，不是教材印刷页码。
- `audio`：关联音频 ID；为空时默认逐词朗读。横向/纵向测试顺序不同，不能只替换录音地址。
- `notes`：可选，练习页显示的版本提示。

`audio.json` 的 `tracks` 记录 `id`、`chapter`、`title`、`url`、`path` 和 `bytes`。原始链接固定到来源仓库版本，避免上游分支变化造成隐式漂移。

原始材料来自同一目录的扫描教材、`智慧语料库2.0（横向测试完整版）.xlsm` 和章节音频。表格与扫描教材第 11 章词目存在差异，故同时保留。不要再次用表格覆盖教材词表。

每次调整后运行 `python3 scripts/validate_data.py`，并核对答案和录音的顺序。校对发现的错字直接修订数据；不要把不确定的 OCR 候选当作可接受答案。
