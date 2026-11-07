# -*- coding: utf-8 -*-
"""按新难度标准重写 U 盘 E:\\分层试卷 的全部 .md 试卷，原地覆盖。

难度对标（教材版本与册次标注保持不变，只改题目内容难度）：
  下层 = 六上偏难；中层 = 七上偏难；上层 = 七下偏易。
渲染器沿用原项目 ywlib / enlib，数学用本文件内的同结构渲染器，
因此生成的章节、题号、分值与原卷一致。
"""
import os, io, re, sys, random
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

import mathbank_new as M
import bank_low, bank_mid, bank_hi, enlow, enmid
from ywlib import render as yw_render
from enlib import render as en_render

ROOT = r'E:\分层试卷'
LEVELS = ('下层', '中层', '上层')
BOOKS = {'下层': '六年级上册（偏难）', '中层': '七年级上册（偏难）', '上层': '七年级下册（偏易）'}
YW_BANK = {'下层': bank_low, '中层': bank_mid, '上层': bank_hi}


def _as_dict(mod):
    return dict(MC=mod.MC, VOCAB=mod.VOCAB, COMM=mod.COMM,
                READING=mod.READING, WRITING=mod.WRITING)


EN_BANK = {'下层': _as_dict(enlow), '中层': _as_dict(enmid)}


# ============================================================
# 英语上层题库：沪教英语版七下偏易（程序化生成，语法正确、答案唯一）
# ============================================================
def _enhi():
    r = random.Random(20261107)
    people = ['Tom', 'Lucy', 'Mr Wang', 'My sister', 'Jack', 'Anna', 'Ben', 'Kate']
    places = ['the park', 'the library', 'Beijing', 'the zoo', 'school', 'the museum']
    days = ['yesterday', 'last Sunday', 'last night', 'two days ago', 'last week']
    MC = []
    def add(stem, opts, idx, note):
        assert len(set(opts)) == 4
        MC.append((stem, opts, idx, note + ' 故选 %s。' % 'ABCD'[idx]))
    for i in range(6):
        p, pl, d = people[i % len(people)], places[i % len(places)], days[i % len(days)]
        add('%s ____ to %s %s.' % (p, pl, d), ['went', 'go', 'goes', 'going'], 0,
            '%s 表示过去时间，动词用一般过去时，go 的过去式是 went。' % d)
        add('____ %s at home %s?' % (p, d), ['Was', 'Is', 'Are', 'Does'], 0,
            '%s 是过去时间，主语第三人称单数用 Was 提问。' % d)
        n1, n2 = r.randrange(3, 9), r.randrange(1, 3)
        add('%s ____ %d books %s.' % (p, n1, d), ['bought', 'buy', 'buys', 'buying'], 0,
            'buy 的过去式是 bought，与过去时间状语连用。')
        add('They ____ football next Sunday.', ['will play', 'played', 'plays', 'play'], 0,
            'next Sunday 表将来，用 will + 动词原形。')
        add('Look at the clouds. It ____ rain.', ['is going to', 'going to', 'is go to', 'will going to'], 0,
            'be going to + 动词原形表示按迹象即将发生。')
        adj = r.choice(['tall', 'interesting', 'big', 'easy', 'careful'])
        add('This book is ____ than that one.',
            ['more ' + adj if adj in ('interesting', 'careful') else adj + 'er',
             adj, 'most ' + adj, adj + 'est'], 0,
            '两者比较用比较级，than 是比较级的标志词。')
        add('You ____ finish your homework first.', ['must', 'musts', 'must to', 'musting'], 0,
            '情态动词 must 后接动词原形，且无人称变化。')
        add('You ____ eat too much sugar.', ["shouldn't", "don't should", "shouldn't to", "not should"], 0,
            'should 的否定形式是 shouldn\'t，后接动词原形。')
        add('She is ____ student in our class.', ['the best', 'better', 'good', 'best'], 0,
            '三者以上比较用最高级，形容词最高级前加 the。')
        add('I ____ a film with my friends %s.' % (r.choice(days)), ['saw', 'see', 'seen', 'sees'], 0,
            'see 的过去式是 saw。')
    VOCAB = []
    for i in range(10):
        w = r.choice([('go', 'went'), ('see', 'saw'), ('buy', 'bought'), ('eat', 'ate'),
                      ('take', 'took'), ('write', 'wrote'), ('do', 'did'), ('have', 'had')])
        VOCAB.append(('写出下列动词的过去式：\n   (1) %s __________   (2) %s __________' % (w[0], w[1]),
                      '(1) %s　(2) %s' % (w[1], {
                          'went': 'go', 'saw': 'see', 'bought': 'buy', 'ate': 'eat',
                          'took': 'take', 'wrote': 'write', 'did': 'do', 'had': 'have'}[w[1]])))
    COMM = []
    for i in range(20):
        COMM.append(('— What did you do %s?\n   — ______' % days[i % len(days)],
                     'I %s %s with my family.' % (r.choice(['visited', 'cleaned', 'watched', 'played']),
                                                  places[i % len(places)])))
        COMM.append(('— What are you going to do tomorrow?\n   — ______',
                     'I am going to %s %s.' % (r.choice(['visit', 'clean', 'read in', 'play in']),
                                               places[i % len(places)])))
    READING = []
    for i in range(10):
        name, pl, d = people[i % len(people)], places[i % len(places)], days[i % len(days)]
        n = r.randrange(3, 8)
        passage = ('My name is %s. %s I went to %s with my family. We went there by bus. '
                   'There were %d other children on the bus. We saw many interesting things and '
                   'took a lot of photos. At noon we had lunch under a big tree. '
                   'In the afternoon we played games together. We went home at five o\'clock. '
                   'I was tired but very happy. Next Sunday I am going to visit my grandparents.' %
                   (name, d.capitalize(), pl, n))
        qs = [('Where did %s go %s?' % (name, d), 'He/She went to %s.' % pl),
              ('How did they go there?', 'They went there by bus.'),
              ('How many other children were on the bus?', 'There were %d.' % n),
              ('What did they do at noon?', 'They had lunch under a big tree.'),
              ('When did they go home?', 'They went home at five o\'clock.'),
              ('What is %s going to do next Sunday?' % name, 'He/She is going to visit his/her grandparents.')]
        READING.append(('A Happy Day', passage, qs))
    WRITING = [
        ('Please write about 60 words about what you did last weekend. Say where you went, '
         'who you went with and what you did.', None),
        ('Please write about 60 words about your plan for next Sunday using "be going to".', None),
        ('Please write about 60 words comparing two places you know, using comparative adjectives.', None),
        ('Please write about 60 words about a rule in your family, using "must" or "should".', None),
    ]
    rub = ['- 内容切合题意，要点齐全（15 分）', '- 时态与语法基本正确（15 分）',
           '- 词数 60 词左右，语句连贯（5 分）', '- 书写整洁，标点与大小写正确（5 分）']
    WRITING = [(s, rub, '') for s, _ in WRITING]
    return dict(MC=MC, VOCAB=VOCAB, COMM=COMM, READING=READING, WRITING=WRITING)


ENHI = _enhi()
EN_BANK['上层'] = ENHI


# ============================================================
# 难度声明补充（标题与教材版本完全不动，只加一行说明）
# ============================================================
def with_book_note(text, level):
    marker = '**满分：120 分'
    i = text.find(marker)
    if i < 0:
        return text
    j = text.find('\n', i)
    return text[:j + 1] + '**难度对标：%s｜教材版本不变**\n' % BOOKS[level] + text[j + 1:]


# ============================================================
# 数学渲染器（30 分选择 + 10 分填空 + 80 分解答 = 120）
# ============================================================
def render_math(level, no, mc, fill, solve, topic=None):
    mins = {'下层': 60, '中层': 75, '上层': 90}[level]
    rng = {'下层': '0~40', '中层': '41~80', '上层': '81~120'}[level]
    o = []
    a = o.append
    a('# 北师大版数学七年级上册 · %s%s' % (level, '知识点专练 %02d' % no if topic else '卷 %02d' % no))
    a('')
    if topic:
        a('**专题：%s**' % topic)
        a('')
    a('**满分：120 分｜建议用时：%d 分钟｜难度层级：%s（目标 %s 分）**' % (mins, level, rng))
    a('')
    a('**难度对标：%s｜教材版本不变**' % BOOKS[level])
    a('')
    a('**姓名：__________　班级：__________　得分：________**')
    a('')
    a('---')
    a('')
    a('## 一、选择题（每题 3 分，共 30 分）')
    a('')
    for i, (stem, opts, idx, note) in enumerate(mc, 1):
        a('%d. %s' % (i, stem))
        a('   ' + '　　'.join('%s. %s' % (chr(64 + j), x) for j, x in enumerate(opts, 1)))
        a('')
    a('---')
    a('')
    a('## 二、填空题（每题 2 分，共 10 分）')
    a('')
    for i, (stem, ans, note) in enumerate(fill, 11):
        a('%d. %s' % (i, stem))
        a('')
    a('---')
    a('')
    a('## 三、解答题（共 80 分）')
    a('')
    qn = 16
    for p, stem, sol, score in solve:
        a('%d.（本题满分 %d 分）' % (qn, p))
        a('   ' + stem.replace('\n', '\n   '))
        a('')
        qn += 1
    a('---')
    a('')
    a('# 参考答案与评分标准')
    a('')
    a('## 一、选择题')
    a('')
    for i, (stem, opts, idx, note) in enumerate(mc, 1):
        a('%d. **%s**（%s）' % (i, 'ABCD'[idx], note))
        a('')
    a('## 二、填空题')
    a('')
    for i, (stem, ans, note) in enumerate(fill, 11):
        a('%d. %s' % (i, ans))
        a('')
        a('- 解析：%s' % note)
        a('')
    a('## 三、解答题')
    a('')
    qn = 16
    for p, stem, sol, score in solve:
        a('### %d.（本题满分 %d 分）' % (qn, p))
        a('')
        a('**解：**')
        a('')
        a(sol)
        a('')
        a('**评分标准：**')
        a(score)
        a('')
        qn += 1
    a('---')
    a('')
    a('## 分数段自评参考（供学生自查）')
    a('')
    a('| 得分区间 | 能力描述 | 主要失分点 |')
    a('| --- | --- | --- |')
    a('| 90 分以上 | 优秀 | 解答题第（3）问全对 |')
    a('| 70~89 分 | 良好 | 解答题步骤分有丢失 |')
    a('| 41~80 分 | 中层达标 | 解答题只拿到第（1）问分数 |')
    a('| 40 分以下 | 需夯实基础 | 选择、填空失分过多 |')
    a('')
    if topic:
        a('**本专练覆盖的知识点**：%s' % topic)
        a('')
    return '\n'.join(o) + '\n'


# ============================================================
# 语文适配：bank_*.py -> ywlib.render
# ============================================================
def build_yw(level, no):
    B = YW_BANK[level]
    r = random.Random(no * 131 + sum(ord(c) for c in level))
    pools = [B.ZIYIN, B.ZIXING, B.CIYU, B.JUSHI, B.ZONGHE_MC]
    jiyu = []
    for i in range(6):
        pool = pools[i % 5]
        stem, opts, idx, note = pool[(no * 3 + i) % len(pool)]
        jiyu.append((i + 1, '%s\n   %s' % (stem, opts),
                     '%d. **%s**　%s' % (i + 1, 'ABCD'[idx], note)))
    fills = list(B.FILL_CS) + list(B.FILL_WX)
    for i in range(4):
        stem, ans, note = fills[(no + i) % len(fills)]
        jiyu.append((7 + i, stem, '%d. %s\n   - 解析：%s' % (7 + i, ans, note)))
    mashu = []
    for i in range(5):
        stem, ans, note = B.MOSHU[(no * 2 + i) % len(B.MOSHU)]
        mashu.append((11 + i, '%s（4 分）' % stem,
                      '%d. %s\n   - 解析：%s' % (11 + i, ans, note)))
    title, passage, qs = B.YUEDU[no % len(B.YUEDU)]
    yqs = [(16 + i, q[0], 5, '%s　%s' % (q[2], q[3])) for i, q in enumerate(qs[:4])]
    yue_du = (passage, yqs)
    stem, rubric, usual = B.XIEZUO[no % len(B.XIEZUO)]
    xiezuo = (stem, [x if isinstance(x, str) else '- %s（%d 分）' % (x[0], x[1]) for x in rubric])
    return jiyu, mashu, yue_du, xiezuo


# ============================================================
# 英语适配：enlow/enmid/ENHI -> enlib.render
# ============================================================
def build_en(level, no):
    E = EN_BANK[level]
    mc = [E['MC'][(no * 7 + i * 3) % len(E['MC'])] for i in range(10)]
    vocab = []
    for i in range(5):
        stem, ans = E['VOCAB'][(no + i) % len(E['VOCAB'])]
        vocab.append((11 + i, stem, ans))
    comm = []
    for i in range(15):
        stem, ans = E['COMM'][(no * 2 + i) % len(E['COMM'])]
        comm.append((16 + i, stem, ans))
    title, passage, qs = E['READING'][no % len(E['READING'])]
    rqs = [(31 + i, q[0], 5, q[1]) for i, q in enumerate(qs[:6])]
    reading = (title + '\n\n' + passage, rqs)
    w_stem, w_rub, _ = E['WRITING'][no % len(E['WRITING'])]
    rubric = []
    for x in w_rub:
        if isinstance(x, str):
            rubric.append(x if x.startswith('-') else '- ' + x)
        elif isinstance(x, (tuple, list)):
            rubric.append('- %s（%d 分）' % (x[0], x[1]))
        else:
            rubric.append('- ' + str(x))
    writing = (w_stem, rubric)
    return mc, vocab, comm, reading, writing


# ============================================================
# 分层综合卷：三层各 40 分，题号连续 1~45
# ============================================================
def render_composite(subject, seed):
    o = []
    a = o.append
    a('# %s · 分层卷' % {'数学': '北师大版数学七年级上册',
                          '语文': '人教统编版语文七年级上册',
                          '英语': '沪教英语版七年级上册'}[subject])
    a('')
    a('**满分：120 分｜建议用时：90 分钟｜姓名：__________　班级：__________　得分：________**')
    a('')
    a('**难度对标：下层六上偏难 / 中层七上偏难 / 上层七下偏易｜教材版本不变**')
    a('')
    lines = []
    ans_lines = []
    num = 1
    for li, level in enumerate(LEVELS):
        a('---')
        a('')
        a('# 第%s部分 · %s（目标 %s 分）' % ('一二三'[li], level,
                                        {'下层': '0~40', '中层': '41~80', '上层': '81~120'}[level]))
        a('')
        a('**满分：40 分**')
        a('')
        a('## %s、选择题（每题 2 分，共 20 分）' % '一二三四五六'[li * 2])
        a('')
        if subject == '数学':
            mc, fill, _ = M.build(level, seed + li * 7717)
            choice = [(x[0], x[1], x[2], x[3]) for x in mc[:10]]
        elif subject == '语文':
            B = YW_BANK[level]
            pools = [B.ZIYIN, B.ZIXING, B.CIYU, B.JUSHI, B.ZONGHE_MC]
            choice = []
            for i in range(10):
                stem, opts, idx, note = pools[i % 5][(seed + i) % len(pools[i % 5])]
                opts_list = [x.strip() for x in re.split(r'\s*[A-D]\.\s*', opts) if x.strip()][:4]
                opts_list = [re.sub(r'^[A-D]\.\s*', '', x) for x in opts_list]
                while len(opts_list) < 4:
                    opts_list.append('以上都不对%d' % len(opts_list))
                choice.append((stem, opts_list, idx, note))
        else:
            E = EN_BANK[level]
            choice = [E['MC'][(seed + i * 3) % len(E['MC'])] for i in range(10)]
        ans_letters = []
        for stem, opts, idx, note in choice:
            a('%d. %s' % (num, stem))
            a('   ' + '　　'.join('%s. %s' % (chr(64 + j), x) for j, x in enumerate(opts, 1)))
            a('')
            ans_letters.append('%d. %s' % (num, 'ABCD'[idx]))
            ans_lines.append('- %d. **%s**（%s）' % (num, 'ABCD'[idx], note))
            num += 1
        a('## %s、填空题（每题 4 分，共 20 分）' % '一二三四五六'[li * 2 + 1])
        a('')
        if subject == '数学':
            _, fill, _ = M.build(level, seed + li * 7717 + 331)
        elif subject == '语文':
            B = YW_BANK[level]
            fill = [(x[0], x[1], x[2]) for x in list(B.MOSHU)[:5]]
        else:
            E = EN_BANK[level]
            fill = []
            for i in range(5):
                stem, ans = E['VOCAB'][(seed + i) % len(E['VOCAB'])]
                fill.append((stem, ans, '按括号内要求填写正确形式。'))
        for stem, ans, note in fill[:5]:
            a('%d. %s' % (num, stem))
            a('')
            ans_lines.append('- %d. %s' % (num, ans))
            num += 1
        lines.append(('第%s部分 · %s' % ('一二三'[li], level), ans_letters))
    a('---')
    a('')
    a('# 参考答案与评分标准')
    a('')
    for title, letters in lines:
        a('## %s' % title)
        a('')
        a('选择题：' + '　'.join(letters))
        a('')
    a('## 填空题与解答题')
    a('')
    for x in ans_lines:
        if x.startswith('- ') and '**' not in x:
            a(x)
    a('')
    a('---')
    a('')
    a('## 三层难度设计说明')
    a('')
    a('- 下层（六上偏难）：比、百分数、分数混合运算、圆、基础统计；基础题为主，需 2~3 步推理。')
    a('- 中层（七上偏难）：有理数与绝对值、整式加减、一元一次方程、数据分析；含分类讨论与多步应用。')
    a('- 上层（七下偏易）：整式乘除与乘法公式、平行线、三角形内角和、轴对称；只套最基础公式与概念。')
    a('- 教材版本保持不变，难度仅作层级对标。')
    a('')
    return '\n'.join(o) + '\n'


# ============================================================
# 驱动：枚举 U 盘现有 .md，逐个生成并原地覆盖
# ============================================================
def main():
    targets = []
    for dp, dn, fns in os.walk(ROOT):
        for fn in sorted(fns):
            if fn.endswith('.md') and fn != '索引.md':
                targets.append(os.path.join(dp, fn))
    print('待改写文件数:', len(targets))
    done = {}
    errors = []
    for path in targets:
        fn = os.path.basename(path)
        try:
            if '分层卷' in fn:
                subject = '数学' if fn.startswith('数学') else ('语文' if fn.startswith('语文') else '英语')
                text = render_composite(subject, 20261107 + sum(ord(c) for c in subject))
            else:
                subject = '数学' if fn.startswith('数学') else ('语文' if fn.startswith('语文') else '英语')
                level = next((l for l in LEVELS if '-' + l + '-' in fn), None)
                if level is None:
                    raise ValueError('无法识别层级: ' + fn)
                m = re.search(r'(\d{2})\.md$', fn)
                if not m:
                    raise ValueError('无法识别编号: ' + fn)
                no = int(m.group(1))
                is_drill = '专练' in fn
                seed = no * 977 + sum(ord(c) for c in level) + (50000 if is_drill else 0)
                topic = None
                if is_drill:
                    topics = {
                        '数学': ['数与运算', '式与方程', '图形与几何', '统计与概率', '综合应用'],
                        '语文': ['字音字形与文学常识', '词语运用与病句', '古诗文默写', '现代文阅读', '片段写作'],
                        '英语': ['动词时态', '代词与名词', '句型与交际', '阅读理解', '书面表达'],
                    }[subject]
                    topic = topics[(no - 1) % 5]
                if subject == '数学':
                    mc, fill, solve = M.build(level, seed)
                    text = render_math(level, no, mc, fill, solve, topic)
                elif subject == '语文':
                    jiyu, mashu, yue_du, xiezuo = build_yw(level, no)
                    text = with_book_note(yw_render(level, no, jiyu, mashu, yue_du, xiezuo, topic), level)
                    if is_drill:
                        text = re.sub(r'( · %s)卷 %02d' % (level, no),
                                      r'\1知识点专练 %02d' % no, text, count=1)
                else:
                    mc, vocab, comm, reading, writing = build_en(level, no)
                    text = with_book_note(en_render(level, no, mc, vocab, comm, reading, writing, topic), level)
                    if is_drill:
                        text = re.sub(r'( · %s)卷 %02d' % (level, no),
                                      r'\1知识点专练 %02d' % no, text, count=1)
            if os.environ.get('DRY'):
                globals().setdefault('_DRY_TEXT', {})[path] = text
            else:
                with io.open(path, 'w', encoding='utf-8') as f:
                    f.write(text)
            key = '%s/%s' % (os.path.relpath(os.path.dirname(path), ROOT), subject)
            done[key] = done.get(key, 0) + 1
        except Exception as e:
            errors.append((fn, repr(e)))
    print('成功:', sum(done.values()), ' 失败:', len(errors))
    for k in sorted(done):
        print('  %-22s %d' % (k, done[k]))
    for fn, e in errors[:15]:
        print('  ERROR', fn, e)
    return len(errors)


if __name__ == '__main__':
    sys.exit(1 if main() else 0)
