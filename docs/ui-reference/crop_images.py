from PIL import Image, ImageDraw, ImageFont
import os, json, sys
import pathlib
ROOT = pathlib.Path(__file__).resolve().parent
SRC = str(ROOT / "assets/images")
OUT = str(ROOT.parent.parent / "frontend/public/assets/images/crops")
os.makedirs(OUT, exist_ok=True)
# name: (source, (x1,y1,x2,y2))
SPEC = {
 # wide heroes (photo part only, right of baked text)
 "hero-ece-chiplab":        ("04-student-dashboard.png", (560, 77, 1228, 346)),
 "hero-mech-cad-robotics":  ("07-projects.png",          (600, 71, 1514, 291)),
 "hero-mech-cad-gearbox":   ("11-learning-resources.png",(640, 71, 1156, 266)),
 "hero-mech-cad-opps":      ("08-opportunities.png",     (610, 68, 1183, 262)),
 "hero-mech-profile-cover": ("05-my-profile.png",        (470, 73, 1018, 259)),
 "hero-mech-resume":        ("06-resume-and-skills.png", (600, 68, 1516, 241)),
 "hero-mech-applications":  ("09-my-applications.png",   (600, 69, 1138, 258)),
 "hero-mech-ai-interview":  ("10-ai-interview-preparation.png", (700, 70, 990, 274)),
 "hero-mech-settings":      ("12-student-settings.png",  (600, 70, 1122, 253)),
 "hero-recruiter-team":     ("13-recruiter-dashboard.png",(660, 71, 1165, 288)),
 "hero-recruiter-jobs":     ("14-jobs-and-requisitions.png",(660, 71, 1153, 284)),
 "hero-plant-engineers":    ("01-landing-page.png",      (1031, 64, 1536, 478)),
 "landing-student":         ("01-landing-page.png",      (1000, 722, 1141, 998)),
 "landing-recruiter":       ("01-landing-page.png",      (1360, 722, 1519, 998)),
 "login-student":           ("02-student-login.png",     (0, 0, 1226, 844)),
 "login-recruiter":         ("03-recruiter-login.png",   (0, 0, 1242, 848)),
 # card thumbnails
 "thumb-mech-gearbox":      ("07-projects.png", (246, 414, 563, 515)),
 "thumb-ece-robot-arm":     ("07-projects.png", (584, 414, 897, 515)),
 "thumb-aero-airfoil":      ("07-projects.png", (918, 412, 1231, 515)),
 "thumb-mech-cnc-fixture":  ("07-projects.png", (246, 746, 563, 833)),
 "thumb-eee-solar":         ("07-projects.png", (584, 746, 897, 833)),
 "thumb-auto-manifold":     ("07-projects.png", (918, 746, 1231, 832)),
 "thumb-mech-gears":        ("11-learning-resources.png", (252, 566, 465, 631)),
 "thumb-civil-steel-frame": ("11-learning-resources.png", (481, 566, 693, 631)),
 "thumb-sim-fea":           ("11-learning-resources.png", (707, 566, 919, 631)),
 "thumb-meta-cnc-machining":("11-learning-resources.png", (933, 566, 1146, 631)),
 "thumb-mech-machine-design":("10-ai-interview-preparation.png", (257, 576, 468, 634)),
 "thumb-sim-fea-2":         ("10-ai-interview-preparation.png", (484, 576, 696, 634)),
 "thumb-meta-manufacturing":("10-ai-interview-preparation.png", (710, 576, 921, 634)),
 "thumb-hr-panel":          ("10-ai-interview-preparation.png", (936, 574, 1147, 634)),
 "thumb-ece-lab-1":         ("04-student-dashboard.png", (345, 512, 540, 580)),
 "thumb-ece-lab-2":         ("04-student-dashboard.png", (690, 512, 890, 580)),
 "thumb-mech-lab-3":        ("04-student-dashboard.png", (1040, 512, 1240, 580)),
 "thumb-profile-builder":   ("04-student-dashboard.png", (1222, 778, 1432, 909)),
}
meta = {}
for name, (src, box) in SPEC.items():
    im = Image.open(os.path.join(SRC, src)).convert("RGB")
    c = im.crop(box)
    c.save(os.path.join(OUT, name + ".jpg"), quality=88, optimize=True)
    meta[name] = {"source": src, "box": box, "size": c.size}
json.dump(meta, open(os.path.join(OUT, "crops.json"), "w"), indent=1)
# contact sheet
names = list(SPEC)
W = 1600; thumbs = []
for n in names:
    im = Image.open(os.path.join(OUT, n + ".jpg")); im.thumbnail((380, 220)); thumbs.append((n, im))
cols = 4; rows = (len(thumbs)+cols-1)//cols
sheet = Image.new("RGB", (cols*400, rows*250), "white"); d = ImageDraw.Draw(sheet)
for i,(n,im) in enumerate(thumbs):
    x, y = (i%cols)*400+10, (i//cols)*250+5
    sheet.paste(im, (x, y+18)); d.text((x, y), n, fill="black")
sheet.save(str(ROOT / "crops-contact-sheet.jpg"), quality=80)
print(len(names), "crops")
