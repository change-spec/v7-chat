# -*- coding: utf-8 -*-
"""生成分层试卷总索引（Markdown）
输出：C:/Users/June2022/Desktop/分层试卷/索引.md
"""
import io, os

ROOT = r"C:/Users/June2022/Desktop/分层试卷"

SUBJECTS = [
    ("语文", "人教统编版", "语文-人教版"),
    ("数学", "北师大版", "数学-北师大版"),
    ("英语", "沪教英语版", "英语-沪教版"),
]
LEVELS = ["下层", "中层", "上层"]
LEVEL_DESC = {
    "下层": "0~40 分（基础题为主，解答题只能拿第 1 问）",
    "中层": "41~80 分（基础题稳拿，中档题能拿部分，压轴做不出）",
    "上层": "81~120 分（多知识点综合，压轴能解第 1-2 问）",
}


def collect():
    """返回 {科目: {层级: {"试卷": [...], "专练": [...]}}}"""
    out = {}
    for subj, ver, prefix in SUBJECTS:
        out[subj] = {}
        for lv in LEVELS:
            d = os.path.join(ROOT, subj, lv)
            papers, drills = [], []
            if os.path.isdir(d):
                for fn in sorted(os.listdir(d)):
                    if not fn.endswith(".md"):
                        continue
                    (drills if "专练" in fn else papers).append(fn)
            out[subj][lv] = {"试卷": papers, "专练": drills}
    return out


def build():
    data = collect()
    total_papers = sum(len(v[lv]["试卷"]) for v in data.values() for lv in LEVELS)
    total_drills = sum(len(v[lv]["专练"]) for v in data.values() for lv in LEVELS)

    L = []
    L.append("# 初一分层练习卷 · 总索引")
    L.append("")
    L.append("> 学龄：**七年级（初一）**｜满分：**120 分**｜配套版本见各科说明")
    L.append("> 所有试卷均含「参考答案与评分标准」，可直接打印使用。")
    L.append("> 打印前请确认：文件已转存为 **Word / WPS** 格式（纯文本 Markdown 在 Word 中打开效果更佳）。")
    L.append("")
    L.append("---")
    L.append("")
    L.append("## 一、总览")
    L.append("")
    L.append("| 科目 | 教材版本 | 下层 | 中层 | 上层 | 小计 |")
    L.append("|---|---|---|---|---|---|")
    for subj, ver, _ in SUBJECTS:
        c = [len(data[subj][lv]["试卷"]) for lv in LEVELS]
        d = [len(data[subj][lv]["专练"]) for lv in LEVELS]
        row = " | ".join(f"{a}+{b}" for a, b in zip(c, d))
        L.append(f"| **{subj}** | {ver} | {row} | {sum(c)+sum(d)} |")
    L.append("")
    L.append(f"**练习卷合计 {total_papers} 套**（每科每层 15 套）　"
             f"**知识点专练合计 {total_drills} 套**（每科每层 5 套）　"
             f"**总计 {total_papers + total_drills} 份**")
    L.append("")
    L.append("---")
    L.append("")

    # 分层综合卷
    L.append("## 二、分层综合卷（每科 1 套，卷内含下/中/上三层）")
    L.append("")
    L.append("用于一次测评：学生自选层级作答，或老师按实际水平指定做到第几部分。")
    L.append("")
    L.append("| 科目 | 文件名 | 说明 |")
    L.append("|---|---|---|")
    for subj, ver, prefix in SUBJECTS:
        fn = f"{prefix}-分层卷.md"
        p = os.path.join(ROOT, fn)
        mark = "✅" if os.path.exists(p) else "⏳ 生成中"
        L.append(f"| {subj} | `{fn}` | {mark} 满分 120 分，三部分各 40 分 |")
    L.append("")
    L.append("---")
    L.append("")

    # 各科详细
    L.append("## 三、分科索引")
    L.append("")
    for idx, (subj, ver, prefix) in enumerate(SUBJECTS):
        L.append(f"### {idx+1}. {subj}（{ver}）")
        L.append("")
        for lv in LEVELS:
            papers = data[subj][lv]["试卷"]
            drills = data[subj][lv]["专练"]
            L.append(f"#### {subj} · {lv}　<sub>{LEVEL_DESC[lv]}</sub>")
            L.append("")
            if papers:
                L.append(f"**练习卷（{len(papers)} 套）**")
                L.append("")
                for i, fn in enumerate(papers, 1):
                    L.append(f"{i}. `{fn}`")
                L.append("")
            if drills:
                L.append(f"**核心知识点专练（{len(drills)} 套，每套专攻一个知识点）**")
                L.append("")
                for i, fn in enumerate(drills, 1):
                    L.append(f"{i}. `{fn}`")
                L.append("")
            if not papers and not drills:
                L.append("_（生成中）_")
                L.append("")
        L.append("---")
        L.append("")

    # 知识点清单
    L.append("## 四、知识点专练覆盖清单")
    L.append("")
    KNOW = {
        "数学": ["有理数的概念、分类与数轴", "绝对值与有理数的大小比较",
                 "有理数的加减法运算", "有理数的乘除与乘方运算",
                 "整式的概念、合并同类项与去括号"],
        "语文": ["字音字形与文学常识", "词语运用与病句辨析", "古诗文默写",
                 "现代文阅读理解", "记叙文片段写作"],
        "英语": ["be 动词与一般现在时", "人称代词与物主代词",
                 "there be 句型与名词单复数", "现在进行时", "书面表达"],
    }
    for subj, ver, prefix in SUBJECTS:
        L.append(f"**{subj}（{ver}）**")
        L.append("")
        for lv in LEVELS:
            drills = data[subj][lv]["专练"]
            if not drills:
                continue
            L.append(f"- *{lv}*：" + "、".join(
                f"`{fn}`（{KNOW[subj][i]}）" for i, fn in enumerate(drills)
                if i < len(KNOW[subj])))
        L.append("")

    L.append("---")
    L.append("")
    L.append("## 五、使用说明")
    L.append("")
    L.append("1. **难度分层**：满分 120 分。下层目标 0~40 分，中层 41~80 分，上层 81~120 分。")
    L.append("2. **打印建议**：Markdown 转 Word 后，用 A4 纵向、页边距 2cm，正文宋体小四号。")
    L.append("3. **答案区**：每份试卷末尾都有「参考答案与评分标准」，解答题含分步给分标准，"
             "并标注该层级学生通常能得多少分 —— 可直接用作讲评依据。")
    L.append("4. **无图形题**：全部题目均可脱离图形独立作答（Word 无法渲染图形），"
             "统计类题目以数据表格形式给出。")
    L.append("5. **命题范围**：严格限定在各科七年级上册教材范围内。")
    L.append("")

    return "\n".join(L), total_papers, total_drills


if __name__ == "__main__":
    content, tp, td = build()
    out = os.path.join(ROOT, "索引.md")
    io.open(out, "w", encoding="utf-8").write(content)
    print("索引已生成:", out)
    print("练习卷 %d 套 / 专练 %d 套 / 共 %d 份" % (tp, td, tp + td))
    print("字节数:", len(content.encode("utf-8")))
