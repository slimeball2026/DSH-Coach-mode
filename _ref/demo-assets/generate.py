#!/usr/bin/env python3
"""生成模拟测试用的两张「截图」（960×600）。

纯 PIL，不联网。产物：user.png（用户提供的提交成功截图）、coach.png（教练截的 Git Bash）。
用它们跑 _ref/demo-note.mjs，记录里的图在预览里才是正常大小。
"""

from PIL import Image, ImageDraw, ImageFont

FONT = "/usr/share/fonts/TTF/JetBrainsMono-Regular.ttf"
FONT_BOLD = "/usr/share/fonts/TTF/JetBrainsMono-Bold.ttf"
W, H = 960, 600


def window(title, dark=True):
    bg = (30, 30, 30) if dark else (247, 247, 247)
    bar = (45, 45, 48) if dark else (232, 232, 232)
    fg = (220, 220, 220) if dark else (40, 40, 40)
    img = Image.new("RGB", (W, H), bg)
    d = ImageDraw.Draw(img)
    d.rectangle([0, 0, W, 44], fill=bar)
    # window buttons
    for i, color in enumerate([(255, 95, 86), (255, 189, 46), (39, 201, 63)]):
        d.ellipse([18 + i * 26, 16, 30 + i * 26, 28], fill=color)
    font = ImageFont.truetype(FONT_BOLD, 18)
    d.text((120, 13), title, font=font, fill=fg)
    d.line([0, 44, W, 44], fill=(80, 80, 80) if dark else (210, 210, 210), width=1)
    return img, d, (220, 220, 220) if dark else (30, 30, 30)


def draw_lines(d, lines, start=(28, 66), size=21, spacing=32):
    font = ImageFont.truetype(FONT, size)
    bold = ImageFont.truetype(FONT_BOLD, size)
    y = start[1]
    for text, color, *rest in lines:
        use = bold if (rest and rest[0] == "bold") else font
        d.text((start[0], y), text, font=use, fill=color)
        y += spacing


# ── 用户截图：提交成功 ────────────────────────────────────────────────────
img, d, fg = window("Git Bash — ~/demo", dark=True)
green = (126, 214, 126)
cyan = (86, 182, 194)
white = (220, 220, 220)
dim = (150, 150, 150)
red = (244, 135, 113)
draw_lines(d, [
    ("$ git log --oneline -1", cyan, "bold"),
    ("a1b2c3d (HEAD -> main) initial commit + README", white),
    ("", white),
    ("$ git status", cyan, "bold"),
    ("On branch main", white),
    ("nothing to commit, working tree clean", green),
    ("", white),
    ("✓ commit ok: 1 file changed, 1 insertion(+)", green, "bold"),
    ("", white),
    ("$ ", cyan, "bold"),
], start=(28, 70), size=21, spacing=38)
d.rectangle([28 + 24, 70 + 38 * 9 - 4, 28 + 24 + 12, 70 + 38 * 9 + 22], fill=white)
img.save("_ref/demo-assets/user.png", "PNG")

# ── 教练截图：pathspec 报错 ─────────────────────────────────────────────
img, d, fg = window("Git Bash — ~/demo", dark=True)
draw_lines(d, [
    ("$ git add README.md", cyan, "bold"),
    ("error: pathspec 'README.md' did not match any file(s) known to git", red),
    ("", white),
    ("$ git status", cyan, "bold"),
    ("On branch main", white),
    ("Changes not staged for commit:", white),
    ("  modified:   readme.md", red),
    ("", white),
    ("hint: case mismatch: README.md vs readme.md", dim),
], start=(28, 70), size=20, spacing=36)
img.save("_ref/demo-assets/coach.png", "PNG")

print("wrote _ref/demo-assets/user.png, _ref/demo-assets/coach.png")
