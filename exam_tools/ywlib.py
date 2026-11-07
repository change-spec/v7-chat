# -*- coding: utf-8 -*-
"""语文卷渲染器（人教统编版七年级上册）。

结构与已有语文卷一致：
  一、积累与运用 40 分 / 二、古诗文默写 20 分 / 三、阅读理解 20 分 / 四、写作 40 分 = 120 分
阅读短文为原创，150-250 字；写作为 60-100 字片段。

数据结构：
  jiyu : [(题号, 题干, 答案与解析)]
  mashu: [(题号, 题干, 答案与解析)]
  yue_du: (短文, [(题号, 题干, 分值, 答案与解析)])
  xiezuo: (题干, [评分标准条目])
"""
import os, io

LEVEL = {
    '下层': dict(minutes=60, rng='0~40'),
    '中层': dict(minutes=75, rng='41~80'),
    '上层': dict(minutes=90, rng='81~120'),
}

HEAD = {
    '下层': "# 人教统编版语文七年级上册 · 下层卷 %02d\n",
    '中层': "# 人教统编版语文七年级上册 · 中层卷 %02d\n",
    '上层': "# 人教统编版语文七年级上册 · 上层卷 %02d\n",
}


def render(level, no, jiyu, mashu, yue_du, xiezuo, topic=None):
    L = LEVEL[level]
    o = []
    a = o.append
    a(HEAD[level] % no)
    a("")
    a("**满分：120 分｜建议用时：%d 分钟｜难度层级：%s（目标 %s 分）**\n" % (
        L['minutes'], level, L['rng']))
    a("**姓名：__________　班级：__________　得分：________**\n")
    a("> 说明：本卷中的\"加粗\"字即题目所说的\"加点字\"。\n")
    a("---\n")
    a("## 一、积累与运用（共 40 分）\n")
    for num, stem, ans in jiyu:
        a("%d. %s" % (num, stem))
        a("")
    a("---\n")
    a("## 二、古诗文默写（共 20 分）\n")
    for num, stem, ans in mashu:
        a("%d. %s" % (num, stem))
        a("")
    a("---\n")
    a("## 三、阅读理解（共 20 分）\n")
    passage, qs = yue_du
    a("阅读下面文字，完成 %d-%d 题。\n" % (qs[0][0], qs[-1][0]))
    a("> " + passage.replace("\n", "\n> "))
    a("")
    for num, stem, pts, ans in qs:
        a("%d. %s（%d 分）" % (num, stem, pts))
        a("")
    a("---\n")
    a("## 四、写作（共 40 分）\n")
    a(xiezuo[0])
    a("")
    a("---\n")
    a("# 参考答案与评分标准\n")
    a("## 一、积累与运用\n")
    for num, stem, ans in jiyu:
        a(ans)
        a("")
    a("## 二、古诗文默写\n")
    for num, stem, ans in mashu:
        a(ans)
        a("")
    a("## 三、阅读理解\n")
    for num, stem, pts, ans in qs:
        a("%d. 【参考答案】%s（%d 分）" % (num, ans, pts))
        a("")
    a("## 四、写作（共 40 分）\n")
    a("**评分标准：**")
    for s in xiezuo[1]:
        a(s)
    a("")
    a("---")
    a("")
    a("## 分数段自评参考（供学生自查）\n")
    a("| 得分区间 | 能力描述 | 主要失分点 |")
    a("| --- | --- | --- |")
    a("| 90 分以上 | 优秀 | 压轴题第（3）问全对 |")
    a("| 70~89 分 | 良好 | 解答题第（3）问有步骤分丢失 |")
    a("| 41~80 分 | 中层达标 | 压轴题只拿到第（1）问分数 |")
    a("| 40 分以下 | 需夯实基础 | 选择、填空失分过多 |")
    return "\n".join(o) + "\n"


def write_paper(root, level, no, jiyu, mashu, yue_du, xiezuo, prefix="语文-人教版",
                topic=None, filename=None):
    fn = filename or ("%s-%s-%02d.md" % (prefix, level, no))
    with io.open(os.path.join(root, fn), 'w', encoding='utf-8') as f:
        f.write(render(level, no, jiyu, mashu, yue_du, xiezuo, topic))
    print('written', fn)
