"""Builds a PDF laid out like LinkedIn's "Save to PDF" export (two columns)."""


def build_linkedin_like_pdf(path: str) -> None:
    from reportlab.lib.pagesizes import letter
    from reportlab.pdfgen import canvas

    c = canvas.Canvas(path, pagesize=letter)
    W, H = letter
    c.setFillColorRGB(0.95, 0.95, 0.95)
    c.rect(0, 0, 200, H, fill=1, stroke=0)
    c.setFillColorRGB(0, 0, 0)

    def side(y, text, size=10.5, bold=False):
        c.setFont("Helvetica-Bold" if bold else "Helvetica", size)
        c.drawString(30, y, text)

    def main(y, text, size=10.5, bold=False):
        c.setFont("Helvetica-Bold" if bold else "Helvetica", size)
        c.drawString(225, y, text)

    y = H - 50
    for t, s, b in [("Contact", 13, True), ("asha.rao@example.com", 10.5, False), ("www.linkedin.com/in/asha-rao-", 10.5, False),
                    ("12345 (LinkedIn)", 10.5, False), ("", 0, False), ("Top Skills", 13, True), ("SolidWorks", 10.5, False),
                    ("ANSYS", 10.5, False), ("GD&T", 10.5, False), ("", 0, False), ("Languages", 13, True),
                    ("English (Full Professional)", 10.5, False), ("Kannada (Native or Bilingual)", 10.5, False), ("", 0, False),
                    ("Certifications", 13, True), ("CSWA - Certified SolidWorks Associate", 10.5, False), ("", 0, False),
                    ("Honors-Awards", 13, True), ("SAE BAJA 2024 - 3rd place", 10.5, False)]:
        if t:
            side(y, t, s, b)
        y -= 16 if t else 10

    y = H - 55
    rows = [
        ("Asha Rao", 26, False), ("Mechanical Engineering Student | Design & Simulation | SAE BAJA", 12, False),
        ("Bengaluru, Karnataka, India", 10.5, False), ("", 0, False),
        ("Summary", 15.75, False), ("Final-year mechanical student who enjoys CAD, FEA and building", 10.5, False),
        ("off-road vehicles.", 10.5, False), ("", 0, False),
        ("Experience", 15.75, False),
        ("Bosch India", 12, False), ("Design Intern", 11.5, False), ("June 2024 - August 2024 (3 months)", 10.5, False),
        ("Bengaluru, Karnataka, India", 10.5, False), ("Modelled brackets in SolidWorks and ran static FEA in ANSYS.", 10.5, False),
        ("", 0, False),
        ("Team Vegavath SAE", 12, False), ("2 years 1 month", 10.5, False),
        ("Suspension Lead", 11.5, False), ("August 2023 - Present (1 year 3 months)", 10.5, False),
        ("Led the suspension sub-team of eight members.", 10.5, False),
        ("Suspension Engineer", 11.5, False), ("October 2022 - August 2023 (11 months)", 10.5, False),
        ("", 0, False),
        ("Education", 15.75, False),
        ("Atria Institute of Technology", 12, False),
        ("Bachelor of Engineering - BE, Mechanical Engineering · (2021 - 2025)", 10.5, False),
        ("Narayana PU College", 12, False), ("PUC, PCMB · (2019 - 2021)", 10.5, False),
    ]
    for t, s, b in rows:
        if t:
            main(y, t, s, b)
        y -= {26: 30, 15.75: 22}.get(s, 15) if t else 10
    c.setFont("Helvetica", 9)
    c.drawString(270, 20, "Page 1 of 1")
    c.save()
