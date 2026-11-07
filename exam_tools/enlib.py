# -*- coding: utf-8 -*-
"""英语卷渲染器（沪教版七年级上册）。

结构：
  一、单项选择 20 分（10 题 × 2 分）
  二、词汇与词形变化 15 分
  三、情景交际 15 分
  四、阅读理解 30 分
  五、书面表达 40 分
  合计 120 分
"""
import os, io

LEVEL = {
    '下层': dict(minutes=60, rng='0~40'),
    '中层': dict(minutes=75, rng='41~80'),
    '上层': dict(minutes=90, rng='81~120'),
}

HEAD = {
    '下层': "# 沪教英语版七年级上册 · 下层卷 %02d\n",
    '中层': "# 沪教英语版七年级上册 · 中层卷 %02d\n",
    '上层': "# 沪教英语版七年级上册 · 上层卷 %02d\n",
}


def render(level, no, mc, vocab, comm, reading, writing, topic=None):
    """mc: [(stem, [opts], ans_idx, note)]
       vocab: [(题号, 题干, 答案)]
       comm: [(题号, 题干, 答案)]
       reading: (短文, [(题号, 题干, 分值, 答案)])
       writing: (题干, [评分标准])"""
    L = LEVEL[level]
    o = []
    a = o.append
    a(HEAD[level] % no)
    a("")
    if topic:
        a("**专题：%s**\n" % topic)
    a("**满分：120 分｜建议用时：%d 分钟｜难度层级：%s（目标 %s 分）**\n" % (
        L['minutes'], level, L['rng']))
    a("**姓名：__________　班级：__________　得分：________**\n")
    a("---\n")
    # 一、单项选择
    a("## 一、单项选择（每题 2 分，共 20 分）\n")
    for i, (stem, opts, idx, note) in enumerate(mc, 1):
        a("%d. %s" % (i, stem))
        a("   " + "　　".join("%s. %s" % (chr(65 + j), o2) for j, o2 in enumerate(opts)))
        a("")
    a("---\n")
    # 二、词汇与词形变化
    a("## 二、词汇与词形变化（共 15 分）\n")
    for num, stem, ans in vocab:
        a("%d. %s" % (num, stem))
        a("")
    a("---\n")
    # 三、情景交际
    a("## 三、情景交际（共 15 分）\n")
    for num, stem, ans in comm:
        a("%d. %s" % (num, stem))
        a("")
    a("---\n")
    # 四、阅读理解
    a("## 四、阅读理解（共 30 分）\n")
    passage, qs = reading
    a("阅读下面短文，完成 %d-%d 题。\n" % (qs[0][0], qs[-1][0]))
    a("> " + passage.replace("\n", "\n> "))
    a("")
    for num, stem, pts, ans in qs:
        a("%d. %s（%d 分）" % (num, stem, pts))
        a("")
    a("---\n")
    # 五、书面表达
    a("## 五、书面表达（共 40 分）\n")
    a(writing[0])
    a("")
    a("---\n")
    a("# 参考答案与评分标准\n")
    a("## 一、单项选择\n")
    for i, (stem, opts, idx, note) in enumerate(mc, 1):
        a("%d. **%s**（%s）" % (i, chr(65 + idx), note))
        a("")
    a("## 二、词汇与词形变化\n")
    for num, stem, ans in vocab:
        a("%d. %s" % (num, ans))
        a("")
    a("## 三、情景交际\n")
    for num, stem, ans in comm:
        a("%d. %s" % (num, ans))
        a("")
    a("## 四、阅读理解\n")
    for num, stem, pts, ans in reading[1]:
        a("%d. 【参考答案】%s（%d 分）" % (num, ans, pts))
        a("")
    a("## 五、书面表达（共 40 分）\n")
    a("**评分标准：**")
    for s in writing[1]:
        a(s)
    a("")
    a("---")
    a("")
    a("## 分数段自评参考（供学生自查）\n")
    a("| 得分区间 | 能力描述 | 主要失分点 |")
    a("| --- | --- | --- |")
    a("| 90 分以上 | 优秀 | 书面表达能写出完整复合句 |")
    a("| 70~89 分 | 良好 | 阅读细节题失分 |")
    a("| 41~80 分 | 中层达标 | 语法填空错较多 |")
    a("| 40 分以下 | 需夯实基础 | be 动词与第三人称单数不熟 |")
    return "\n".join(o) + "\n"


def write_paper(root, level, no, mc, vocab, comm, reading, writing, prefix="英语-沪教版",
                topic=None, filename=None):
    fn = filename or ("%s-%s-%02d.md" % (prefix, level, no))
    with io.open(os.path.join(root, fn), 'w', encoding='utf-8') as f:
        f.write(render(level, no, mc, vocab, comm, reading, writing, topic))
    print('written', fn)
