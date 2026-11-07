# -*- coding: utf-8 -*-
"""把 U 盘 E:\\分层试卷 里所有 .md 转成同目录的 .docx（原地生成，不删 md）。

针对试卷排版：
- 中文 eastAsia 字体（宋体正文 / 黑体标题），避免 Word 里出现方块乱码
- 题号 "1. " 保留为纯文本，不让 Word 自动编号（否则题号会重排）
- Markdown 表格转真正的 Word 表格
- **加粗** / `等宽` 行内样式
- A4 / 2cm 边距 / 五号字 / 1.25 倍行距，打印友好
- 页脚居中页码
"""
import os, re, sys, io, traceback
from docx import Document
from docx.shared import Pt, Cm, RGBColor
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.enum.table import WD_TABLE_ALIGNMENT
from docx.oxml.ns import qn
from docx.oxml import OxmlElement

ROOT = r'E:\分层试卷'
BODY_FONT = '宋体'
HEAD_FONT = '黑体'
MONO_FONT = 'Consolas'


def set_font(run, name=BODY_FONT, size=10.5, bold=None, color=None):
    run.font.name = name
    run.font.size = Pt(size)
    run._element.rPr.rFonts.set(qn('w:eastAsia'), name)
    if bold is not None:
        run.bold = bold
    if color is not None:
        run.font.color.rgb = RGBColor(*color)


INLINE = re.compile(r'(\*\*.+?\*\*|`.+?`)')


def add_inline(par, text, size=10.5, base_bold=False, font=BODY_FONT):
    """解析行内 **粗体** 与 `等宽`，写入段落。"""
    text = text.replace('\\', '') if False else text  # 保留反斜杠（试卷里没有 LaTeX）
    pos = 0
    for m in INLINE.finditer(text):
        if m.start() > pos:
            r = par.add_run(text[pos:m.start()])
            set_font(r, font, size, base_bold)
        tok = m.group()
        if tok.startswith('**'):
            r = par.add_run(tok[2:-2])
            set_font(r, font, size, True)
        else:
            r = par.add_run(tok[1:-1])
            set_font(r, MONO_FONT, size - 0.5, base_bold)
        pos = m.end()
    if pos < len(text):
        r = par.add_run(text[pos:])
        set_font(r, font, size, base_bold)
    if not text:
        r = par.add_run('')
        set_font(r, font, size, base_bold)


def add_hr(doc):
    p = doc.add_paragraph()
    p.paragraph_format.space_before = Pt(4)
    p.paragraph_format.space_after = Pt(6)
    pPr = p._p.get_or_add_pPr()
    bd = OxmlElement('w:pBdr')
    bottom = OxmlElement('w:bottom')
    bottom.set(qn('w:val'), 'single')
    bottom.set(qn('w:sz'), '4')
    bottom.set(qn('w:color'), '999999')
    bd.append(bottom)
    pPr.append(bd)
    return p


def add_page_number(doc):
    sec = doc.sections[0]
    p = sec.footer.paragraphs[0]
    p.alignment = WD_ALIGN_PARAGRAPH.CENTER
    r = p.add_run('第 ')
    set_font(r, BODY_FONT, 9)
    fld = OxmlElement('w:fldSimple')
    fld.set(qn('w:instr'), 'PAGE')
    p._p.append(fld)
    r2 = p.add_run(' 页')
    set_font(r2, BODY_FONT, 9)


def is_table_sep(line):
    return bool(re.match(r'^\s*\|?[\s:\-\|]+\|[\s:\-\|]*$', line)) and '-' in line


def add_table(doc, rows):
    if not rows:
        return
    ncol = max(len(r) for r in rows)
    t = doc.add_table(rows=len(rows), cols=ncol)
    t.style = 'Table Grid'
    t.alignment = WD_TABLE_ALIGNMENT.CENTER
    for i, row in enumerate(rows):
        for j in range(ncol):
            cell = t.cell(i, j)
            txt = row[j] if j < len(row) else ''
            par = cell.paragraphs[0]
            par.paragraph_format.space_after = Pt(0)
            add_inline(par, txt.strip(), 9.5, base_bold=(i == 0))
    doc.add_paragraph().paragraph_format.space_after = Pt(2)


def parse_table_row(line):
    s = line.strip()
    if s.startswith('|'):
        s = s[1:]
    if s.endswith('|'):
        s = s[:-1]
    return [c.strip() for c in s.split('|')]


def convert(md_path, docx_path):
    text = io.open(md_path, encoding='utf-8').read()
    lines = text.split('\n')

    doc = Document()
    sec = doc.sections[0]
    sec.page_width = Cm(21.0)
    sec.page_height = Cm(29.7)
    sec.top_margin = Cm(1.9)
    sec.bottom_margin = Cm(1.9)
    sec.left_margin = Cm(2.0)
    sec.right_margin = Cm(2.0)

    normal = doc.styles['Normal']
    normal.font.name = BODY_FONT
    normal.font.size = Pt(10.5)
    normal._element.rPr.rFonts.set(qn('w:eastAsia'), BODY_FONT)
    normal.paragraph_format.line_spacing = 1.25
    normal.paragraph_format.space_after = Pt(3)

    add_page_number(doc)

    i = 0
    n = len(lines)
    while i < n:
        raw = lines[i]
        line = raw.rstrip()
        stripped = line.strip()

        # 空行
        if not stripped:
            i += 1
            continue

        # 分隔线
        if re.match(r'^\s*-{3,}\s*$', stripped):
            add_hr(doc)
            i += 1
            continue

        # 表格
        if stripped.startswith('|') and i + 1 < n and is_table_sep(lines[i + 1]):
            rows = [parse_table_row(lines[i])]
            i += 2
            while i < n and lines[i].strip().startswith('|'):
                rows.append(parse_table_row(lines[i]))
                i += 1
            add_table(doc, rows)
            continue

        # 标题
        m = re.match(r'^(#{1,6})\s+(.*)$', stripped)
        if m:
            lvl = len(m.group(1))
            p = doc.add_paragraph()
            pf = p.paragraph_format
            pf.space_before = Pt(10 if lvl <= 2 else 7)
            pf.space_after = Pt(5)
            pf.keep_with_next = True
            if lvl == 1:
                p.alignment = WD_ALIGN_PARAGRAPH.CENTER
                size, font, bold = 16, HEAD_FONT, True
            elif lvl == 2:
                size, font, bold = 13, HEAD_FONT, True
            elif lvl == 3:
                size, font, bold = 11.5, HEAD_FONT, True
            else:
                size, font, bold = 10.5, HEAD_FONT, True
            add_inline(p, m.group(2), size, base_bold=True, font=font)
            i += 1
            continue

        # 引用 / 说明
        if stripped.startswith('>'):
            p = doc.add_paragraph()
            p.paragraph_format.left_indent = Cm(0.6)
            p.paragraph_format.space_after = Pt(4)
            add_inline(p, stripped.lstrip('> ').strip(), 9.5)
            i += 1
            continue

        # 题号行 / 有序列表：保留原样编号，不交给 Word 自动编号
        mnum = re.match(r'^(\d+)\.\s+(.*)$', stripped)
        if mnum:
            p = doc.add_paragraph()
            p.paragraph_format.space_before = Pt(4)
            p.paragraph_format.space_after = Pt(1)
            add_inline(p, stripped, 10.5)
            i += 1
            continue

        # 无序列表
        if re.match(r'^[-*+]\s+', stripped):
            p = doc.add_paragraph()
            p.paragraph_format.left_indent = Cm(0.6)
            p.paragraph_format.space_after = Pt(1)
            add_inline(p, '• ' + re.sub(r'^[-*+]\s+', '', stripped), 10.5)
            i += 1
            continue

        # 普通段落（含 3 空格缩进的选项行）
        p = doc.add_paragraph()
        indent = len(line) - len(line.lstrip(' '))
        if indent >= 2:
            p.paragraph_format.left_indent = Cm(0.55)
            p.paragraph_format.space_after = Pt(1)
        # 居中：姓名行 / 满分行
        if ('姓名：' in stripped and '班级：' in stripped) or stripped.startswith('**满分'):
            p.alignment = WD_ALIGN_PARAGRAPH.CENTER
        add_inline(p, stripped, 10.5)
        i += 1

    doc.save(docx_path)
    return len(doc.paragraphs)


def main():
    mds = []
    for dp, dn, fns in os.walk(ROOT):
        for fn in fns:
            if fn.endswith('.md'):
                mds.append(os.path.join(dp, fn))
    mds.sort()
    print('待转换: %d' % len(mds))
    ok, fail = 0, []
    for idx, p in enumerate(mds, 1):
        out = p[:-3] + '.docx'
        try:
            convert(p, out)
            ok += 1
        except Exception as e:
            fail.append((p, str(e)))
        if idx % 40 == 0:
            print('  ...%d/%d' % (idx, len(mds)))
    print('\n成功 %d / 失败 %d' % (ok, len(fail)))
    for p, e in fail[:10]:
        print('  FAIL', p, e)
    return len(fail)


if __name__ == '__main__':
    sys.exit(1 if main() else 0)
