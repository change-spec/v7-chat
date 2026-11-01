#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
把 Markdown 试卷里的 LaTeX 公式转成纯文本（Word/WPS 可直接阅读）。
转换后初一学生能直接看懂，题目与答案保持一致。

用法：python fix_latex.py <目录>
"""
import io, os, re, sys

# ---------- LaTeX -> Unicode ----------
# 注意：正则里 LaTeX 命令的反斜杠需写成 \\\\（re 字符串里是 \\，再传给 re 需 \\\\）
# 这里统一用普通字符串 + re.escape 处理，避免 \c \p 等非法转义。
SYMBOLS = [
    ('\\times', '×'), ('\\div', '÷'), ('\\cdot', '·'), ('\\pm', '±'),
    ('\\ge', '≥'), ('\\le', '≤'), ('\\ne', '≠'), ('\\approx', '≈'),
    ('\\equiv', '≡'), ('\\circ', '°'), ('\\angle', '∠'),
    ('\\pi', 'π'), ('\\alpha', 'α'), ('\\beta', 'β'), ('\\theta', 'θ'),
    ('\\parallel', '∥'), ('\\perp', '⊥'), ('\\sim', '∽'),
    ('\\sqrt', '√'), ('\\ldots', '…'), ('\\cdots', '⋯'), ('\\dots', '…'),
    ('\\left', ''), ('\\right', ''),
    ('\\in', '∈'), ('\\cup', '∪'), ('\\cap', '∩'),
    ('\\rightarrow', '→'), ('\\to', '→'), ('\\leftarrow', '←'),
    ('\\overline', ''), ('\\overrightarrow', ''),
    ('\\quad', ' '), ('\\qquad', '  '), ('\\,', ' '), ('\\;', ' '),
    ('\\!', ''),
    ('\\text', ''), ('\\mathrm', ''), ('\\mathbf', ''), ('\\rm', ''),
    ('\\displaystyle', ''), ('\\limits', ''),
    ('\\dfrac', ''), ('\\frac', ''),
]

SUPERSCRIPT = {'0': '⁰', '1': '¹', '2': '²', '3': '³', '4': '⁴',
               '5': '⁵', '6': '⁶', '7': '⁷', '8': '⁸', '9': '⁹',
               '-1': '⁻¹', '-2': '⁻²', 'n': 'ⁿ', '+': '⁺'}
SUBSCRIPT = {'0': '₀', '1': '₁', '2': '₂', '3': '₃', '4': '₄',
              '5': '₅', '6': '₆', '7': '₇', '8': '₈', '9': '₉',
              'n': 'ₙ', 'a': 'ₐ', 'b': 'ᵦ'}

# \dfrac{分子}{分母}
RE_FRAC = re.compile(r'\\[dt]?frac\s*\{([^{}]*)\}\s*\{([^{}]*)\}')
RE_FRAC_SIMPLE = re.compile(r'\\[dt]?frac\s*(\d)\s*(\d)')

# 常用 Unicode 分数（真分数），比 (1)÷(3) 更直观
UNI_FRAC = {
    (1, 2): '½', (1, 3): '⅓', (2, 3): '⅔', (1, 4): '¼', (3, 4): '¾',
    (1, 5): '⅕', (2, 5): '⅖', (3, 5): '⅗', (4, 5): '⅘',
    (1, 6): '⅙', (5, 6): '⅚', (1, 7): '⅐', (1, 8): '⅛', (3, 8): '⅜',
    (5, 8): '⅝', (7, 8): '⅞', (1, 9): '⅑', (1, 10): '⅒',
}


def frac_to_text(m):
    num = m.group(1).strip()
    den = m.group(2).strip()
    if re.fullmatch(r'-?\d+', den) and re.fullmatch(r'-?[\d.]+', num):
        try:
            n, d = int(num), int(den)
        except ValueError:
            return '(%s)/(%s)' % (num, den)
        if n > 0 and d > 0:
            key = (n, d)
            if key in UNI_FRAC:
                return UNI_FRAC[key]
            # 负分数：写成 -½
            if (-n, d) in UNI_FRAC:
                return '-' + UNI_FRAC[(-n, d)]
        return '(%s)/(%s)' % (num, den)
    return '(%s)/(%s)' % (num, den)


def convert_math(text):
    """把一段含 LaTeX 的文本转成纯文本"""
    # 1. 分式（可能嵌套，多轮处理）
    for _ in range(5):
        new = RE_FRAC.sub(frac_to_text, text)
        if new == text:
            break
        text = new
    text = RE_FRAC_SIMPLE.sub(lambda m: '(%s)÷(%s)' % (m.group(1), m.group(2)), text)

    # 2. 上下标
    text = re.sub(r'\^\{?(-?\d+)\}?',
                  lambda m: SUPERSCRIPT.get(m.group(1), '^' + m.group(1)), text)
    text = re.sub(r'_\{?(\d+)\}?',
                  lambda m: SUBSCRIPT.get(m.group(1), '_' + m.group(1)), text)
    text = re.sub(r'\^\{([^{}]*)\}', lambda m: '^' + m.group(1), text)
    text = re.sub(r'_\{([^{}]*)\}', lambda m: '_' + m.group(1), text)

    # 3. 符号替换（用 re.escape 安全处理反斜杠）
    for cmd, rep in SYMBOLS:
        text = re.sub(re.escape(cmd) + r'(?![a-zA-Z])', rep, text)

    # 4. 清理残留花括号
    text = text.replace('{', '').replace('}', '')

    # 5. 修掉被空格命令拆散的 "3 \ 4"
    text = re.sub(r'(\d)\s+\\(\d)', r'\1÷\2', text)

    # 6. 合并负号与分数：-(1)÷(3) -> -(1/3) ；(-2)÷(3) -> -(2/3)
    text = re.sub(r'\-\((\d+)\)÷\((\d+)\)', r'-(\1/\2)', text)
    text = re.sub(r'\(-(\d+)\)÷\((\d+)\)', r'(\1/\2)', text)
    # 6b. 去掉分数外的多余括号：(-(3/2)) -> -(3/2)
    text = re.sub(r'\(-\((\d+/\d+)\)\)', r'-(\1)', text)
    text = re.sub(r'\(-(\d+/\d+)\)', r'-(\1)', text)
    # 6c. 整数直接跟在负号后不需要括号：(-5) -> -5（仅当括号内是纯数字）
    text = re.sub(r'\(-\s*(\d+)\s*\)', r'\1', text)
    # 6d. 分数与除号统一：全部用 a/b 形式
    text = re.sub(r'\((\d+)\)÷\((\d+)\)', r'(\1/\2)', text)
    text = re.sub(r'\-(\d+)\((\d+)/(\d+)\)', r'-(\2/\3)', text)
    text = re.sub(r'\+\((\d+)/(\d+)\)', r'+(\1/\2)', text)

    return text


def fix_content(text):
    # 1. 行内公式 $...$
    text = re.sub(r'\$\s*([^$\n]{1,300}?)\s*\$',
                  lambda m: convert_math(m.group(1)), text)

    # 2. 块公式 $$...$$
    def block(m):
        lines = []
        for ln in m.group(1).split('\n'):
            ln = convert_math(ln).replace('\\', '').strip()
            if ln:
                lines.append(ln)
        return '\n'.join(lines)

    text = re.sub(r'\$\$(.+?)\$\$', block, text, flags=re.S)

    # 3. 清理软换行符等控制字符
    text = re.sub(r'[‹›‪-‮⁠-⁤﻿]', '', text)

    # 4. 残留裸反斜杠
    text = re.sub(r'\\(?![a-zA-Z\s])', '', text)
    text = re.sub(r'\\(?![\s])', '', text)

    # 5. 排版清理
    text = re.sub(r'[ \t]+$', '', text, flags=re.M)
    text = re.sub(r'\n{4,}', '\n\n\n', text)

    return text


def main():
    root = sys.argv[1] if len(sys.argv) > 1 else '.'
    files = []
    for dirpath, dirnames, filenames in os.walk(root):
        for fn in filenames:
            if fn.lower().endswith('.md'):
                files.append(os.path.join(dirpath, fn))
    files.sort()
    print('扫描 %d 个文件\n' % len(files))

    fixed = 0
    for path in files:
        try:
            raw = open(path, 'rb').read()
            try:
                text = raw.decode('utf-8')
            except UnicodeDecodeError:
                text = raw.decode('gbk', errors='replace')
                print('  [编码修复 GBK->UTF8] %s' % os.path.basename(path))
            new = fix_content(text)
            if new != text:
                open(path, 'w', encoding='utf-8', newline='\n').write(new)
                fixed += 1
        except Exception as e:
            print('  [跳过] %s: %s' % (os.path.basename(path), e))

    print('\n已处理 %d / %d 个文件' % (fixed, len(files)))

    print('\n=== 残留检查 ===')
    total_dollar = 0
    total_cmd = 0
    for path in files:
        try:
            t = open(path, encoding='utf-8').read()
        except Exception:
            continue
        total_dollar += t.count('$')
        total_cmd += len(re.findall(r'\\[a-zA-Z]+', t))
    print('  残留 $ : %d' % total_dollar)
    print('  残留 LaTeX 命令: %d' % total_cmd)


if __name__ == '__main__':
    main()
