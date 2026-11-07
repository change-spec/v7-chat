# -*- coding: utf-8 -*-
"""新难度数学题库（参数化生成，答案自动计算，保证自洽）。

下层 = 北师大版六上偏难；中层 = 七上偏难；上层 = 七下偏易。
教材版本不变，只是册次/知识点范围随难度走。
所有题目纯文字可答，无 LaTeX、无图形依赖、选项唯一正确。
"""
import random
import re
from fractions import Fraction
from math import gcd


def _fmt(x):
    if isinstance(x, Fraction):
        return str(x.numerator) if x.denominator == 1 else "%d/%d" % (x.numerator, x.denominator)
    if isinstance(x, float):
        if abs(x - round(x)) < 1e-9:
            return str(int(round(x)))
        return ("%.2f" % x).rstrip('0').rstrip('.')
    return str(x)


def _variant(s, k):
    """由一个选项造出形式相近但数值不同的干扰项，用于补齐去重后的空位。"""
    m = re.search(r'-?\d+', s)
    if m:
        v = int(m.group()) + k
        return s[:m.start()] + str(v) + s[m.end():]
    return "%s（变式%d）" % (s, k)


def _mc(stem, opts, idx, body):
    """统一补上「故选 X」；自动去重并补齐，保证四个选项互不相同且答案位置不变。"""
    assert len(opts) == 4 and 0 <= idx <= 3, (stem, opts, idx)
    opts = [_fmt(o) for o in opts]
    ans = opts[idx]
    others = []
    for j, o in enumerate(opts):
        if j == idx:
            continue
        if o != ans and o not in others:
            others.append(o)
    k = 1
    while len(others) < 3:
        cand = _variant(ans, k)
        k += 1
        if cand != ans and cand not in others:
            others.append(cand)
        if k > 200:
            others.append("以上都不对" + str(k))
    out = [None] * 4
    out[idx] = ans
    oi = 0
    for j in range(4):
        if j == idx:
            continue
        out[j] = others[oi]
        oi += 1
    assert len(set(out)) == 4, (stem, out)
    return (stem, out, idx, body + "故选 %s。" % "ABCD"[idx])


# ============================================================
# 下层：六上偏难（比、百分数、分数混合运算、圆、平均数）
# ============================================================
def low_mc(r):
    k = r.randrange(9)
    if k == 0:
        a, b = r.choice([(12, 18), (15, 25), (24, 36), (16, 20), (21, 14), (30, 45)])
        g = gcd(a, b)
        ans = "%d:%d" % (a // g, b // g)
        wrong = ["%d:%d" % (a, b), "%d:%d" % (b // g, a // g), "%d:%d" % (a // 2 or a, b // 2 or b)]
        return _mc("把 %d:%d 化成最简整数比，结果是（　　）" % (a, b),
                   [ans] + wrong[:3], 0,
                   "前项和后项同时除以最大公因数 %d，得 %s。" % (g, ans))
    if k == 1:
        a, b = r.choice([(3, 4), (2, 5), (6, 8), (9, 12), (5, 10), (7, 14)])
        v = Fraction(a, b)
        wrong = [Fraction(b, a), Fraction(a * 2, b), Fraction(a, b * 2)]
        return _mc("%d:%d 的比值是（　　）" % (a, b),
                   [v] + wrong, 0,
                   "比值 = 前项 ÷ 后项 = %d/%d = %s。" % (a, b, _fmt(v)))
    if k == 2:
        base = r.choice([80, 120, 200, 250, 360, 400])
        p = r.choice([15, 20, 25, 40, 60, 75])
        v = base * p // 100
        return _mc("%d 的 %d%% 是（　　）" % (base, p),
                   [v, base * p // 50, base - v, base + v], 0,
                   "%d × %d%% = %d × %s = %d。" % (base, p, base, _fmt(Fraction(p, 100)), v))
    if k == 3:
        price = r.choice([120, 180, 240, 300, 360, 480])
        zhe = r.choice([6, 7, 8, 85, 9])
        if zhe == 85:
            pay = price * 85 // 100
            word, pct = "八五折", "85%"
        else:
            pay = price * zhe // 10
            word, pct = "%d折" % zhe, "%d%%" % (zhe * 10)
        return _mc("一件商品原价 %d 元，打%s出售，现价是（　　）元" % (price, word),
                   [pay, price - pay, price * (100 - int(pct.rstrip('%'))) // 100, price + pay // 2], 0,
                   "打%s即按原价的 %s 出售，%d × %s = %d 元。" % (word, pct, price, pct, pay))
    if k == 4:
        a, b, c = r.choice([(1, 2, 3), (2, 3, 4), (3, 4, 5), (1, 3, 6), (2, 5, 10)])
        v = Fraction(1, a) + Fraction(1, b) if r.random() < .5 else Fraction(1, a) * Fraction(1, b) + Fraction(1, c)
        return _mc("计算 1/%d + 1/%d 的结果是（　　）" % (a, b),
                   [Fraction(1, a) + Fraction(1, b), Fraction(1, a + b),
                    Fraction(1, a) * Fraction(1, b), Fraction(2, a + b)], 0,
                   "通分：1/%d + 1/%d = %d/%d + %d/%d = %s。" % (
                       a, b, b, a * b, a, a * b, _fmt(Fraction(1, a) + Fraction(1, b))))
    if k == 5:
        rad = r.choice([2, 3, 4, 5, 6, 10])
        c = 2 * 314 * rad // 100
        return _mc("一个圆的半径是 %d cm，取 π = 3.14，它的周长是（　　）cm" % rad,
                   [c, 314 * rad // 100, 2 * rad, 314 * rad * rad // 100], 0,
                   "C = 2πr = 2 × 3.14 × %d = %s cm。" % (rad, _fmt(c)))
    if k == 6:
        rad = r.choice([2, 3, 4, 5, 10])
        s = 314 * rad * rad // 100
        return _mc("一个圆的半径是 %d cm，取 π = 3.14，它的面积是（　　）cm²" % rad,
                   [s, 2 * 314 * rad // 100, 314 * rad // 100, rad * rad], 0,
                   "S = πr² = 3.14 × %d² = %s cm²。" % (rad, _fmt(s)))
    if k == 7:
        x = r.choice([200, 250, 400, 500, 600])
        p = r.choice([10, 20, 25, 50])
        v = x * (100 + p) // 100
        return _mc("比 %d 多 %d%% 的数是（　　）" % (x, p),
                   [v, x * p // 100, x - x * p // 100, x + p], 0,
                   "把 %d 看作单位「1」，所求为 %d × (1 + %d%%) = %d。" % (x, x, p, v))
    total = r.choice([60, 90, 120, 180, 240])
    a, b = r.choice([(2, 3), (3, 5), (1, 4), (3, 7), (5, 7)])
    part = total * b // (a + b)
    return _mc("把 %d 个球按 %d:%d 分成两份，较多的一份是（　　）个" % (total, a, b),
               [part, total * a // (a + b), total // 2, total - part // 2], 0,
               "总份数 %d + %d = %d，每份 %d ÷ %d = %d，较多一份 %d × %d = %d 个。" % (
                   a, b, a + b, total, a + b, total // (a + b), b, total // (a + b), part))


def low_fill(r):
    k = r.randrange(5)
    if k == 0:
        a, b = r.choice([(12, 16), (18, 24), (20, 25), (14, 21)])
        g = gcd(a, b)
        return ("把 %d:%d 化成最简整数比是 ______。" % (a, b),
                "%d:%d" % (a // g, b // g), "同除以最大公因数 %d。" % g)
    if k == 1:
        p = r.choice([25, 40, 60, 75, 80])
        return ("把 %d%% 化成最简分数是 ______。" % p,
                _fmt(Fraction(p, 100)), "%d%% = %d/100 = %s。" % (p, p, _fmt(Fraction(p, 100))))
    if k == 2:
        d = r.choice([4, 6, 8, 10, 12])
        return ("一个圆的直径是 %d cm，取 π = 3.14，它的周长是 ______ cm。" % d,
                _fmt(314 * d // 100), "C = πd = 3.14 × %d = %s cm。" % (d, _fmt(314 * d // 100)))
    if k == 3:
        a, b = r.choice([(2, 3), (3, 4), (1, 5), (5, 6)])
        v = Fraction(a, b) * Fraction(b, a + 1)
        return ("计算 %d/%d × %d/%d = ______。" % (a, b, b, a + 1),
                _fmt(v), "分子乘分子、分母乘分母后约分得 %s。" % _fmt(v))
    nums = [r.randrange(60, 100) for _ in range(4)]
    avg = sum(nums) / 4
    return ("四次测验成绩为 %d、%d、%d、%d 分，平均分是 ______ 分。" % tuple(nums),
            _fmt(avg), "总分 %d 分，除以 4 得 %s 分。" % (sum(nums), _fmt(avg)))


def low_solve(r):
    out = []
    # 30 分：百分数多步应用
    x = r.choice([400, 500, 600, 800])
    p1, p2 = r.choice([(20, 25), (25, 20), (30, 50), (40, 25)])
    first = x * p1 // 100
    rest = x - first
    second = rest * p2 // 100
    left = rest - second
    out.append((30,
        "书店运来 %d 本书。第一天卖出总数的 %d%%，第二天卖出剩下书的 %d%%。\n"
        "   （1）第一天卖出多少本？（2）第二天卖出多少本？（3）还剩多少本？" % (x, p1, p2),
        "解：(1) %d × %d%% = %d（本）。\n"
        "　　(2) 第一天后剩 %d − %d = %d（本），第二天卖出 %d × %d%% = %d（本）。\n"
        "　　(3) 还剩 %d − %d = %d（本）。" % (
            x, p1, first, x, first, rest, rest, p2, second, rest, second, left),
        "- 第（1）问列式正确得 5 分，算出 %d 本得 5 分（共 10 分）\n"
        "- 第（2）问先求剩余 %d 本得 5 分，列式得 3 分，算出 %d 本得 2 分（共 10 分）\n"
        "- 第（3）问列式得 5 分，算出 %d 本得 5 分（共 10 分）\n"
        "- 下层学生通常能得 10~18 分" % (first, rest, second, left)))
    # 25 分：按比分配
    total = r.choice([120, 180, 240, 300])
    a, b = r.choice([(2, 3), (3, 5), (1, 4), (4, 5)])
    per = total // (a + b)
    out.append((25,
        "把 %d 元奖金按 %d:%d 分给甲、乙两人。\n"
        "   （1）两人各得多少元？（2）甲比乙少得多少元？" % (total, a, b),
        "解：(1) 总份数 %d + %d = %d，每份 %d ÷ %d = %d（元）。\n"
        "　　甲得 %d × %d = %d（元），乙得 %d × %d = %d（元）。\n"
        "　　(2) %d − %d = %d（元）。" % (
            a, b, a + b, total, a + b, per, a, per, a * per, b, per, b * per,
            b * per, a * per, b * per - a * per),
        "- 求出总份数与每份数得 8 分\n- 甲、乙各得数各 5 分（共 10 分）\n"
        "- 第（2）问列式与结果共 7 分\n- 下层学生通常能得 8~14 分"))
    # 25 分：圆与百分数综合（文字描述，不用图）
    rad = r.choice([4, 5, 6, 10])
    s = 314 * rad * rad // 100
    p = r.choice([20, 25, 40, 50])
    used = s * p // 100
    out.append((25,
        "一块圆形花圃的半径是 %d m，取 π = 3.14。其中 %d%% 的面积种月季，其余种草坪。\n"
        "   （1）花圃面积是多少平方米？（2）种月季的面积是多少？（3）草坪面积是多少？" % (rad, p),
        "解：(1) S = πr² = 3.14 × %d² = %s（m²）。\n"
        "　　(2) %s × %d%% = %s（m²）。\n"
        "　　(3) %s − %s = %s（m²）。" % (
            rad, _fmt(s), _fmt(s), p, _fmt(used), _fmt(s), _fmt(used), _fmt(s - used)),
        "- 第（1）问公式与结果共 9 分\n- 第（2）问列式与结果共 8 分\n"
        "- 第（3）问列式与结果共 8 分\n- 下层学生通常能得 9~15 分"))
    return out


# ============================================================
# 中层：七上偏难（有理数、绝对值、整式、一元一次方程、数据）
# ============================================================
def mid_mc(r):
    k = r.randrange(9)
    if k == 0:
        a, b = r.randrange(-9, 10), r.randrange(-9, 10)
        v = a + b
        return _mc("计算 (%d) + (%d) 的结果是（　　）" % (a, b),
                   [v, a - b, -v, a * b], 0,
                   "同号相加取相同符号并把绝对值相加，异号相加取绝对值较大者的符号并用较大绝对值减较小绝对值，%d + (%d) = %d。" % (a, b, v))
    if k == 1:
        x = r.randrange(-8, 9)
        return _mc("若 |x| = %d，则 x 的值是（　　）" % abs(x or 3),
                   ["±%d" % abs(x or 3), str(abs(x or 3)), str(-abs(x or 3)), "0"], 0,
                   "绝对值等于同一个正数的数有两个，它们互为相反数，故 x = ±%d。" % abs(x or 3))
    if k == 2:
        a, b, c = r.randrange(2, 7), r.randrange(2, 7), r.randrange(2, 7)
        v = a * b - c
        return _mc("计算 %d × %d − %d 的结果是（　　）" % (a, b, c),
                   [v, a * (b - c), a * b + c, -(a * b - c)], 0,
                   "先乘后减：%d × %d = %d，再 %d − %d = %d。" % (a, b, a * b, a * b, c, v))
    if k == 3:
        x = r.randrange(2, 9)
        v = 3 * x * x - 2 * x + 1 - (x * x + x - 4)
        return _mc("化简 3x² − 2x + 1 − (x² + x − 4)，当 x = %d 时值为（　　）" % x,
                   [3 * x * x - 2 * x + 1 - (x * x + x - 4),
                    3 * x * x - 2 * x + 1 - x * x - x - 4,
                    3 * x * x - 2 * x + 1 + x * x + x - 4,
                    2 * x * x - x + 5 + 1], 0,
                   "原式 = 3x² − 2x + 1 − x² − x + 4 = 2x² − 3x + 5，代入 x = %d 得 %d。" % (x, 2 * x * x - 3 * x + 5))
    if k == 4:
        a = r.randrange(2, 9)
        x = r.randrange(2, 8)
        c = a * x + 3
        sol = (c - 3) // a
        return _mc("方程 %dx + 3 = %d 的解是（　　）" % (a, c),
                   ["x = %d" % sol, "x = %d" % (sol + 1), "x = %d" % (sol - 1), "x = %d" % (a + 3)], 0,
                   "移项得 %dx = %d − 3 = %d，两边同除以 %d 得 x = %d。" % (a, c, c - 3, a, sol))
    if k == 5:
        n = r.choice([123000, 45600, 7800000, 30500, 960000])
        s = ("%.2f" % (n / (10 ** (len(str(n)) - 1))))
        exp = len(str(n)) - 1
        return _mc("用科学记数法表示 %d，正确的是（　　）" % n,
                   ["%s × 10^%d" % (s, exp), "%s × 10^%d" % (s, exp + 1),
                    "%s × 10^%d" % (s, exp - 1), "%d × 10^1" % n], 0,
                   "把小数点左移 %d 位得 %s，故为 %s × 10^%d。" % (exp, s, s, exp))
    if k == 6:
        a = r.randrange(-6, 7) or 2
        b = r.randrange(1, 7)
        v = abs(a) + abs(b) - abs(a + b)
        return _mc("已知 a = %d，b = %d，则 |a| + |b| − |a + b| 的值是（　　）" % (a, b),
                   [abs(a) + abs(b) - abs(a + b), abs(a) + abs(b), abs(a + b), 0], 0,
                   "|%d| = %d，|%d| = %d，|%d + %d| = %d，故 %d + %d − %d = %d。" % (
                       a, abs(a), b, abs(b), a, b, abs(a + b), abs(a), abs(b), abs(a + b), v))
    if k == 7:
        nums = sorted([r.randrange(60, 100) for _ in range(5)])
        mid = nums[2]
        return _mc("一组数据 %s 的中位数是（　　）" % "、".join(map(str, nums)),
                   [mid, nums[0], sum(nums) // 5, nums[4]], 0,
                   "按从小到大排列后共 5 个数，中间第 3 个是 %d。" % mid)
    a, b = r.randrange(2, 9), r.randrange(2, 9)
    return _mc("计算 (−%d) × %d + %d 的结果是（　　）" % (a, b, a * b),
               [-a * b + a * b, -a * b - a * b, a * b + a * b, -a * b], 0,
               "先算乘法：(−%d) × %d = −%d，再加 %d 得 %d。" % (a, b, a * b, a * b, -a * b + a * b))


def mid_fill(r):
    k = r.randrange(5)
    if k == 0:
        a, b = r.randrange(-9, 10), r.randrange(-9, 10)
        return ("计算 (%d) − (%d) = ______。" % (a, b), _fmt(a - b),
                "减去一个数等于加上它的相反数：%d + (%d) = %d。" % (a, -b, a - b))
    if k == 1:
        x = r.randrange(2, 9)
        return ("若 |x − %d| = 0，则 x = ______。" % x, str(x),
                "绝对值为 0 的数只有 0，故 x − %d = 0，x = %d。" % (x, x))
    if k == 2:
        a, b = r.randrange(2, 9), r.randrange(2, 9)
        return ("合并同类项 %da²b − %da²b = ______。" % (a, b), "%da²b" % (a - b),
                "系数相加 %d − %d = %d，字母部分不变。" % (a, b, a - b))
    if k == 3:
        x = r.randrange(2, 9)
        return ("当 x = %d 时，代数式 2x² − 3x + 5 的值是 ______。" % x,
                str(2 * x * x - 3 * x + 5),
                "2 × %d² − 3 × %d + 5 = %d。" % (x, x, 2 * x * x - 3 * x + 5))
    nums = [r.randrange(60, 100) for _ in range(4)]
    return ("数据 %s 的平均数是 ______。" % "、".join(map(str, nums)),
            _fmt(sum(nums) / 4), "总和 %d ÷ 4 = %s。" % (sum(nums), _fmt(sum(nums) / 4)))


def mid_solve(r):
    out = []
    # 30 分：一元一次方程应用（行程）
    v = r.choice([40, 50, 60, 80])
    t = r.choice([2, 3, 4, 5])
    d = v * t
    out.append((30,
        "甲、乙两地相距 %d km。一辆汽车以每小时 %d km 的速度从甲地开往乙地。\n"
        "   （1）几小时到达？（2）若提速 20%%，需要几小时？（3）比原来提前多少小时？" % (d, v),
        "解：(1) 设需 t 小时，%dt = %d，解得 t = %d（小时）。\n"
        "　　(2) 提速后速度 %d × (1 + 20%%) = %d（km/h），%d ÷ %d = %s（小时）。\n"
        "　　(3) %d − %s = %s（小时）。" % (
            v, d, t, v, v * 6 // 5, d, v * 6 // 5, _fmt(Fraction(d * 5, v * 6)),
            t, _fmt(Fraction(d * 5, v * 6)), _fmt(Fraction(t, 1) - Fraction(d * 5, v * 6))),
        "- 第（1）问设未知数并列方程得 6 分，解得 %d 小时得 4 分（共 10 分）\n"
        "- 第（2）问求新速度得 4 分，列式得 4 分，结果得 2 分（共 10 分）\n"
        "- 第（3）问列式与结果共 10 分\n- 中层学生通常能得 16~24 分" % t))
    # 25 分：整式化简求值
    a, x, y = r.randrange(2, 7), r.randrange(-4, 5), r.randrange(2, 6)
    val = 2 * x * x - 3 * x * y + 5 + (a * x * x + x * y - 3)
    out.append((25,
        "先化简，再求值：2x² − 3xy + 5 + (%dx² + xy − 3)，其中 x = %d，y = %d。\n"
        "   （1）写出化简结果；（2）代入求值。" % (a, x, y),
        "解：(1) 原式 = 2x² − 3xy + 5 + %dx² + xy − 3 = %dx² − 2xy + 2。\n"
        "　　(2) 代入 x = %d，y = %d：%d × %d² − 2 × %d × %d + 2 = %d。" % (
            a, 2 + a, x, y, 2 + a, x, x, y, (2 + a) * x * x - 2 * x * y + 2),
        "- 去括号正确得 6 分\n- 合并同类项得 %dx² − 2xy + 2 得 9 分\n- 代入与计算共 10 分\n- 中层学生通常能得 12~20 分" % (2 + a)))
    # 25 分：绝对值分类讨论 + 数据统计（文字表格）
    nums = [r.randrange(60, 100) for _ in range(5)]
    avg = sum(nums) / 5
    out.append((25,
        "某小组 5 次测验成绩如下表。\n\n"
        "   | 次数 | 第1次 | 第2次 | 第3次 | 第4次 | 第5次 |\n"
        "   | --- | --- | --- | --- | --- | --- |\n"
        "   | 成绩 | %d | %d | %d | %d | %d |\n\n"
        "   （1）求平均分；（2）求最高分与最低分的差；（3）若第 6 次考了 %d 分，新的平均分是多少？" % (
            *nums, r.randrange(70, 100)),
        "解：(1) 总分 %d + %d + %d + %d + %d = %d，平均分 %d ÷ 5 = %s（分）。\n"
        "　　(2) 最高 %d 分，最低 %d 分，相差 %d 分。\n"
        "　　(3) 六次总分 %d + %d = %d，平均分 %s（分）。" % (
            *nums, sum(nums), sum(nums), _fmt(avg), max(nums), min(nums), max(nums) - min(nums),
            sum(nums), nums[-1], sum(nums) + nums[-1], _fmt((sum(nums) + nums[-1]) / 6)),
        "- 第（1）问总分与平均分共 9 分\n- 第（2）问极差共 8 分\n"
        "- 第（3）问新总分与新平均分共 8 分\n- 中层学生通常能得 14~21 分"))
    return out


# ============================================================
# 上层：七下偏易（整式乘除、平行线、三角形、轴对称）
# ============================================================
def hi_mc(r):
    k = r.randrange(9)
    if k == 0:
        a, m, n = r.randrange(2, 6), r.randrange(2, 5), r.randrange(2, 5)
        return _mc("计算 x^%d · x^%d 的结果是（　　）" % (m, n),
                   ["x^%d" % (m + n), "x^%d" % (m * n), "%dx^%d" % (a, m + n), "x^%d" % (m - n + 2)], 0,
                   "同底数幂相乘，底数不变、指数相加：x^%d · x^%d = x^%d。" % (m, n, m + n))
    if k == 1:
        m, n = r.randrange(2, 5), r.randrange(2, 5)
        return _mc("计算 (x^%d)^%d 的结果是（　　）" % (m, n),
                   ["x^%d" % (m * n), "x^%d" % (m + n), "x^%d" % (m ** n), "%dx^%d" % (n, m * n)], 0,
                   "幂的乘方，底数不变、指数相乘：(x^%d)^%d = x^%d。" % (m, n, m * n))
    if k == 2:
        a, b = r.randrange(2, 7), r.randrange(2, 7)
        return _mc("利用平方差公式计算 (%d + %d)(%d − %d) 的结果是（　　）" % (a, b, a, b),
                   [a * a - b * b, a * a + b * b, (a - b) * (a - b), a * a - 2 * a * b + b * b], 0,
                   "(a + b)(a − b) = a² − b² = %d² − %d² = %d − %d = %d。" % (
                       a, b, a * a, b * b, a * a - b * b))
    if k == 3:
        a, b = r.randrange(2, 7), r.randrange(2, 7)
        return _mc("利用完全平方公式展开 (x + %d)²，正确的是（　　）" % a,
                   ["x² + %dx + %d" % (2 * a, a * a), "x² + %d" % (a * a),
                    "x² + %dx + %d" % (a, a * a), "x² + %dx + %d" % (2 * a, a)], 0,
                   "(x + a)² = x² + 2ax + a² = x² + %dx + %d。" % (2 * a, a * a))
    if k == 4:
        ang = r.choice([35, 40, 50, 65, 70, 110, 120])
        return _mc("两直线平行，被第三条直线所截，若一个同位角是 %d°，则它的同位角是（　　）" % ang,
                   ["%d°" % ang, "%d°" % (180 - ang), "%d°" % (90 - ang if ang < 90 else ang - 90),
                    "%d°" % (ang + 30)], 0,
                   "两直线平行，同位角相等，故仍为 %d°。" % ang)
    if k == 5:
        a = r.choice([40, 50, 60, 70, 80])
        c = 180 - 2 * a
        return _mc("等腰三角形的顶角是 %d°，它的一个底角是（　　）" % (180 - 2 * a),
                   ["%d°" % a, "%d°" % (180 - 2 * a), "%d°" % (90 - a), "%d°" % (2 * a)], 0,
                   "三角形内角和 180°，两底角相等，每个底角 = (180° − %d°) ÷ 2 = %d°。" % (180 - 2 * a, a))
    if k == 6:
        a, b = r.choice([(3, 4), (4, 5), (5, 6), (6, 8), (2, 7)])
        return _mc("下列三组线段中，能组成三角形的是（　　）",
                   ["%d、%d、%d" % (a, b, a + b - 1), "%d、%d、%d" % (a, b, a + b + 1),
                    "1、2、3", "2、2、5"], 0,
                   "任意两边之和大于第三边。%d + %d = %d > %d 成立；其余组均有两边之和不大于第三边。" % (
                       a, b, a + b, a + b - 1))
    if k == 7:
        return _mc("下列图形中，对称轴条数最多的是（　　）",
                   ["正方形", "长方形（非正方形）", "等腰三角形（非等边）", "平行四边形（非矩形、非菱形）"], 0,
                   "正方形有 4 条对称轴；长方形 2 条；等腰三角形 1 条；一般平行四边形 0 条。")
    m = r.randrange(2, 6)
    return _mc("计算 (2x)^%d 的结果是（　　）" % m,
               ["%dx^%d" % (2 ** m, m), "2x^%d" % m, "%dx^%d" % (2 * m, m), "2x^%d" % (2 * m)], 0,
               "积的乘方：每个因式分别乘方，(2x)^%d = 2^%d · x^%d = %dx^%d。" % (m, m, m, 2 ** m, m))


def hi_fill(r):
    k = r.randrange(5)
    if k == 0:
        m, n = r.randrange(2, 6), r.randrange(2, 6)
        return ("计算 a^%d ÷ a^%d = ______（a ≠ 0）。" % (m + n, n), "a^%d" % m,
                "同底数幂相除，底数不变、指数相减：a^%d ÷ a^%d = a^%d。" % (m + n, n, m))
    if k == 1:
        x = r.randrange(2, 8)
        return ("利用平方差公式计算 (%d + 1)(%d − 1) = ______。" % (x, x), str(x * x - 1),
                "(x + 1)(x − 1) = x² − 1 = %d² − 1 = %d。" % (x, x * x - 1))
    if k == 2:
        ang = r.choice([30, 45, 60, 70, 110])
        return ("两直线平行，一个内错角是 %d°，与它互补的邻补角是 ______°。" % ang,
                str(180 - ang), "邻补角之和为 180°，故为 180° − %d° = %d°。" % (ang, 180 - ang))
    if k == 3:
        a, b = r.choice([(50, 60), (40, 70), (65, 55), (80, 30)])
        return ("三角形中，∠A = %d°，∠B = %d°，则 ∠C = ______°。" % (a, b),
                str(180 - a - b), "内角和 180°，∠C = 180° − %d° − %d° = %d°。" % (a, b, 180 - a - b))
    return ("正方形有 ______ 条对称轴。", "4", "两条对角线所在直线与两组对边中点连线，共 4 条。")


def hi_solve(r):
    out = []
    # 30 分：整式乘除与公式
    a, b = r.randrange(2, 7), r.randrange(2, 7)
    out.append((30,
        "计算下列各题：\n   （1）(x + %d)(x − %d)；\n   （2）(x + %d)²；\n"
        "   （3）先化简 (x + %d)² − (x + %d)(x − %d)，再取 x = %d 求值。" % (a, a, b, a, b, b, a),
        "解：(1) 平方差公式：x² − %d。\n"
        "　　(2) 完全平方公式：x² + %dx + %d。\n"
        "　　(3) 原式 = (x² + %dx + %d) − (x² − %d) = %dx + %d。\n"
        "　　代入 x = %d 得 %d × %d + %d = %d。" % (
            a * a, 2 * b, b * b, 2 * a, a * a, b * b, 2 * a, a * a + b * b,
            a, 2 * a, a, a * a + b * b, 2 * a * a + a * a + b * b),
        "- 第（1）问公式与结果共 8 分\n- 第（2）问公式与结果共 8 分\n"
        "- 第（3）问展开 6 分、合并 4 分、代入求值 4 分（共 14 分）\n"
        "- 上层学生通常能得 20~27 分"))
    # 25 分：平行线角度（文字描述清楚，不用图）
    ang = r.choice([50, 60, 65, 70, 110])
    out.append((25,
        "直线 AB 与 CD 平行，直线 EF 分别与它们相交。交点处，位于 AB 下方、EF 右侧的角记为 ∠1，"
        "位于 CD 上方、EF 左侧的角记为 ∠2，∠1 与 ∠2 是内错角。已知 ∠1 = %d°。\n"
        "   （1）求 ∠2；（2）求与 ∠1 相邻且互补的角；（3）说明 ∠1 与 ∠2 为什么相等。" % ang,
        "解：(1) 两直线平行，内错角相等，∠2 = ∠1 = %d°。\n"
        "　　(2) 与 ∠1 相邻的角与 ∠1 组成平角，为 180° − %d° = %d°。\n"
        "　　(3) 平行线的性质：两直线平行，内错角相等。" % (ang, ang, 180 - ang),
        "- 第（1）问写出性质得 4 分，结果 %d° 得 5 分（共 9 分）\n"
        "- 第（2）问列式与结果共 8 分\n- 第（3）问点明「两直线平行，内错角相等」得 8 分\n"
        "- 上层学生通常能得 17~23 分" % ang))
    # 25 分：三角形 + 轴对称
    a, b = r.choice([(50, 60), (45, 65), (70, 40), (35, 75)])
    c = 180 - a - b
    out.append((25,
        "在 △ABC 中，∠A = %d°，∠B = %d°。\n"
        "   （1）求 ∠C；（2）若 AD 平分 ∠A 且交 BC 于 D，求 ∠BAD；\n"
        "   （3）等边三角形有几条对称轴？请说明理由。" % (a, b),
        "解：(1) ∠C = 180° − %d° − %d° = %d°。\n"
        "　　(2) AD 平分 ∠A，∠BAD = %d° ÷ 2 = %s°。\n"
        "　　(3) 3 条：等边三角形每条边上的中线（也是高和角平分线）所在直线都是对称轴。" % (
            a, b, c, a, _fmt(Fraction(a, 2))),
        "- 第（1）问列式与结果共 9 分\n- 第（2）问角平分线定义与结果共 9 分\n"
        "- 第（3）问答 3 条得 4 分、理由得 3 分（共 7 分）\n"
        "- 上层学生通常能得 17~23 分"))
    return out


BANK = {
    '下层': (low_mc, low_fill, low_solve),
    '中层': (mid_mc, mid_fill, mid_solve),
    '上层': (hi_mc, hi_fill, hi_solve),
}


def build(level, seed):
    """生成一份数学卷的 (mc, fill, solve)。
    mc: [(stem,[4opts],idx,note)] × 10；fill: [(stem,ans,note)] × 5；
    solve: [(points,stem,sol,score)]，分值合计 80。"""
    r = random.Random(seed)
    fmc, ffill, fsolve = BANK[level]
    mc = []
    used = set()
    while len(mc) < 10:
        item = fmc(r)
        if item[0] in used and len(used) < 10:
            continue
        used.add(item[0])
        mc.append(item)
    fill = []
    while len(fill) < 5:
        item = ffill(r)
        if item[0] in [x[0] for x in fill]:
            continue
        fill.append(item)
    solve = fsolve(r)
    assert sum(p for p, _, _, _ in solve) == 80, solve
    return mc, fill, solve
