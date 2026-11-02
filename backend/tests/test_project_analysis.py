"""Multimodal project analysis: extractors, analysers, claims, scoring, reports, API and permissions.
All AI calls are faked — tests never touch the network."""
import io
import json
import struct
import zipfile

import pytest
from fastapi.testclient import TestClient
from sqlmodel import Session

from app.auth import create_access_token
from app.db import CandidateProfile, CandidateUser, ProjectAnalysisJob, StudentProject, engine
from app.main import app
from app.services import llm_stream
from app.services.project_analysis import ai, media
from app.services.project_analysis.extractors import extract
from app.services.project_analysis.schemas import Claim, Evidence, enforce_claims

WOKWI = {"version": 1, "parts": [
    {"type": "wokwi-arduino-uno", "id": "uno"}, {"type": "wokwi-led", "id": "led1", "attrs": {"color": "red"}},
    {"type": "wokwi-hc-sr04", "id": "ultra"}, {"type": "wokwi-resistor", "id": "r1", "attrs": {"value": "220"}}],
    "connections": [["uno:13", "r1:1", "green", []], ["r1:2", "led1:A", "green", []], ["uno:9", "ultra:TRIG", "green", []],
                    ["uno:10", "ultra:ECHO", "green", []], ["uno:5V", "ultra:VCC", "red", []]]}
SKETCH = """#include <NewPing.h>
#define LED 13
const int TRIG = 9;
const int ECHO = 10;
// digitalWrite(4, HIGH);  <- commented out, must be ignored
void setup() { Serial.begin(9600); pinMode(LED, OUTPUT); pinMode(7, OUTPUT); }
void loop() { long d = analogRead(A0); digitalWrite(LED, HIGH); digitalWrite(7, LOW); Serial.println("pin 4"); delay(100); }
"""
NETLIST = """(export (version "E")
 (components (comp (ref "U1") (value "ATmega328P")) (comp (ref "R1") (value "10k")))
 (nets (net (code "1") (name "/D7") (node (ref "U1") (pin "13") (pinfunction "PD7")) (node (ref "R1") (pin "1")))
       (net (code "2") (name "GND") (node (ref "U1") (pin "8")))
       (net (code "3") (name "+5V") (node (ref "U1") (pin "7")))))"""
SCH = """(kicad_sch (lib_symbols (symbol "Device:R" (property "Reference" "R")))
 (symbol (lib_id "Device:R") (property "Reference" "R1") (property "Value" "10k") (property "Footprint" "R_0805"))
 (symbol (lib_id "power:GND") (property "Reference" "#PWR01") (property "Value" "GND"))
 (label "D7" (at 0 0 0)))"""
NOTEBOOK = {"cells": [
    {"cell_type": "code", "execution_count": 1, "source": ["from sklearn.preprocessing import StandardScaler\n", "X = StandardScaler().fit_transform(X)\n",
                                                           "from sklearn.model_selection import train_test_split\n", "Xtr, Xte, ytr, yte = train_test_split(X, y)\n",
                                                           "m = RandomForestClassifier()\n", "m.fit(Xtr, ytr)\n"], "outputs": []},
    {"cell_type": "code", "execution_count": 2, "source": ["print(accuracy_score(yte, m.predict(Xte)))"],
     "outputs": [{"output_type": "stream", "text": ["Accuracy: 0.71\n"]}]}], "metadata": {}, "nbformat": 4, "nbformat_minor": 5}


def ascii_cube():
    v = [(0, 0, 0), (1, 0, 0), (1, 1, 0), (0, 1, 0), (0, 0, 1), (1, 0, 1), (1, 1, 1), (0, 1, 1)]
    faces = [(0, 2, 1), (0, 3, 2), (4, 5, 6), (4, 6, 7), (0, 1, 5), (0, 5, 4), (1, 2, 6), (1, 6, 5), (2, 3, 7), (2, 7, 6), (3, 0, 4), (3, 4, 7)]
    out = ["solid cube"]
    for f in faces:
        out += ["facet normal 0 0 0", " outer loop"] + [f"  vertex {v[i][0]} {v[i][1]} {v[i][2]}" for i in f] + [" endloop", "endfacet"]
    return ("\n".join(out + ["endsolid cube"])).encode()


@pytest.fixture
def client(monkeypatch):
    monkeypatch.setattr(llm_stream, "configured_providers", lambda: [])
    monkeypatch.setattr(ai, "gemini_available", lambda: False)
    monkeypatch.setattr(media, "gemini_available", lambda: False)
    with TestClient(app) as c:
        yield c


def H(email="stu@example.com", role="candidate"):
    return {"Authorization": f"Bearer {create_access_token(username=email, role=role)}"}


def student(email="stu@example.com", name="Asha Rao"):
    with Session(engine) as s:
        u = CandidateUser(username=email, password_hash="x")
        s.add(u)
        s.commit()
        s.refresh(u)
        s.add(CandidateProfile(candidate_id=u.id, full_name=name, contact_email=email))
        s.commit()
        return u.id


def project(client, domain="electronics", desc="An ultrasonic parking sensor on Arduino Uno that lights a red LED when an object is closer than 20 cm.", **extra):
    r = client.post("/api/student/projects", json={"title": "Parking sensor", "description": desc, "domain": domain, **extra}, headers=H())
    assert r.status_code == 201, r.text
    return r.json()


def upload(client, pid, name, data, email="stu@example.com"):
    return client.post(f"/api/student/projects/{pid}/files", files={"file": (name, data)}, headers=H(email))


def analyse(client, pid):
    r = client.post(f"/api/student/projects/{pid}/analyse", headers=H())
    assert r.status_code == 200, r.text
    got = client.get(f"/api/student/projects/{pid}/analysis", headers=H()).json()
    assert got["status"] == "done", got
    return got


# ── extractors ───────────────────────────────────────────────────────────────

def test_arduino_pins_aliases_and_comments():
    ex = extract("park.ino", SKETCH.encode())
    pins = {p["pin"]: p["uses"] for p in ex.data["pins"]}
    assert set(pins) == {"D13", "D7", "A0"}          # D4 only appears in a comment / string
    assert "output" in pins["D13"] and "analog input" in pins["A0"]
    assert ex.data["setup"] and ex.data["loop"]
    assert any("9600 baud" in f.fact for f in ex.facts)
    assert any("NewPing.h" in f.fact and f.confidence == "medium" for f in ex.facts)


def test_kicad_netlist_and_schematic():
    net = extract("board.net", NETLIST.encode())
    assert {c["ref"] for c in net.data["components"]} == {"U1", "R1"}
    assert "D7" in net.data["pins"] and "+5V" in net.data["power"]
    assert any("Net '/D7' connects U1:13(PD7), R1:1" in f.fact for f in net.facts)
    sch = extract("board.kicad_sch", SCH.encode())
    assert [c["ref"] for c in sch.data["components"]] == ["R1"]       # library defs and power symbols excluded
    assert sch.data["power"] == ["GND"] and sch.data["pins"] == ["D7"]
    assert any("netlist" in w for w in sch.warnings)


def test_wokwi_diagram():
    ex = extract("diagram.json", json.dumps(WOKWI).encode())
    assert ex.kind == "wokwi"
    assert set(ex.data["pins"]) == {"D13", "D9", "D10"}
    assert "hc-sr04" in ex.data["pin_targets"]["D9"]


def test_stl_ascii_binary_and_step():
    a = extract("cube.stl", ascii_cube())
    assert a.data["triangles"] == 12 and a.data["watertight"] and abs(a.data["volume"] - 1.0) < 1e-6
    tri = struct.pack("<12f", 0, 0, 1, 0, 0, 0, 2, 0, 0, 0, 3, 0) + b"\x00\x00"
    b = extract("tri.stl", b"\x00" * 80 + struct.pack("<I", 1) + tri)
    assert b.data["triangles"] == 1 and not b.data["watertight"] and b.data["bbox"] == (2.0, 3.0, 0.0)
    step = "ISO-10303-21;\nDATA;\n#1=PRODUCT('Gear housing','',''  ,(#2));\n#3=PRODUCT('Shaft','','',(#2));\n#4=MANIFOLD_SOLID_BREP('',#5);\n#6=NEXT_ASSEMBLY_USAGE_OCCURRENCE('1','','',#1,#3,$);\nENDSEC;"
    s = extract("box.step", step.encode())
    assert s.data["parts"] == ["Gear housing", "Shaft"] and s.data["solids"] == 1 and s.data["assembly_links"] == 1


def test_dxf_ifc_notebook_csv():
    import ezdxf
    doc = ezdxf.new()
    msp = doc.modelspace()
    msp.add_line((0, 0), (100, 0), dxfattribs={"layer": "OUTLINE"})
    msp.add_linear_dim(base=(0, 10), p1=(0, 0), p2=(100, 0)).render()
    msp.add_text("SHAFT Ø20", dxfattribs={"layer": "NOTES"})
    buf = io.StringIO()
    doc.write(buf)
    d = extract("part.dxf", buf.getvalue().encode())
    assert d.data["dimensions"] == [100.0] and "OUTLINE" in d.data["layers"] and d.data["annotations"]

    ifc = "ISO-10303-21;\nHEADER;FILE_SCHEMA(('IFC4'));ENDSEC;\nDATA;\n#1=IFCWALL('a',#2,'W1',$,$,$,$,$,$);\n#2=IFCWALL('b',#2,'W2',$,$,$,$,$,$);\n#3=IFCCOLUMN('c',#2,'C1',$,$,$,$,$,$);\n#4=IFCBUILDINGSTOREY('d',#2,'Ground Floor',$,$,$,$,$,$,$);\n#5=IFCMATERIAL('M25 Concrete');\nENDSEC;"
    i = extract("house.ifc", ifc.encode())
    assert i.data["elements"] == {"Wall": 2, "Column": 1} and i.data["storeys"] == ["Ground Floor"] and i.data["materials"] == ["M25 Concrete"]

    nb = extract("train.ipynb", json.dumps(NOTEBOOK).encode())
    assert nb.data["models"] == ["RandomForestClassifier"]
    assert nb.data["metrics"][0]["metric"] == "accuracy" and nb.data["metrics"][0]["value"] == 71.0
    assert any("before train_test_split" in f for f in nb.data["findings"])

    c = extract("data.csv", b"a,b,label\n1,2,x\n1,2,x\n3,,y\n")
    assert c.data["rows"] == 3 and c.data["duplicates"] == 1 and c.data["missing_pct"] > 0


def test_zip_reads_members_and_rejects_bombs():
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
        z.writestr("fw/main.ino", SKETCH)
        z.writestr("node_modules/x/index.js", "ignored")
        z.writestr("requirements.txt", "flask==3.0\n")
    ex = extract("src.zip", buf.getvalue())
    assert any(m.get("type") == "arduino" for m in ex.data["members"])
    assert not any("node_modules" in p for p in ex.data["paths"])
    assert "requirements.txt" in ex.data["deps"]
    bomb = io.BytesIO()
    with zipfile.ZipFile(bomb, "w", zipfile.ZIP_DEFLATED) as z:
        z.writestr("big.txt", "0" * (5 * 1024 * 1024))
    assert extract("bomb.zip", bomb.getvalue()).data.get("rejected")


# ── claim enforcement & helpers ──────────────────────────────────────────────

def test_enforce_claims_downgrades_unsupported_statuses():
    ev = [Evidence(id="e1", source_type="file", source_ref="a.ino", fact="Code uses pin D7", method="parsed", confidence="high"),
          Evidence(id="e2", source_type="video", source_ref="00:10", fact="LED lights", method="vision_model", confidence="medium"),
          Evidence(id="e3", source_type="file", source_ref="b.ino", fact="x", method="parsed", confidence="high", origin="client", confirmed=False)]
    cs = [Claim(id="c1", text="uses pin 7", type="component", status="verified", evidence_ids=["e1"]),
          Claim(id="c2", text="bogus", status="verified", evidence_ids=["nope"]),
          Claim(id="c3", text="LED lights up", type="feature", status="verified", evidence_ids=["e2"]),
          Claim(id="c4", text="uses an ESP32", type="component", status="verified", evidence_ids=["e2"]),
          Claim(id="c5", text="from browser", type="component", status="verified", evidence_ids=["e3"]),
          Claim(id="c6", text="contradicted w/o proof", status="contradicted", evidence_ids=[])]
    enforce_claims(cs, ev)
    assert [c.status for c in cs] == ["verified", "unverified", "verified", "partially_verified", "partially_verified", "unverified"]


def test_spoken_digit_matching():
    assert media.code_found("4827", "my code is four eight two seven")
    assert media.code_found("4827", "4-8-2-7")
    assert not media.code_found("4827", "four eight two six")


# ── end-to-end through the API ───────────────────────────────────────────────

def test_electronics_end_to_end_without_ai(client):
    student()
    p = project(client)
    assert p["domain"] == "electronics" and len(p["challenge_code"]) == 4
    assert upload(client, p["id"], "diagram.json", json.dumps(WOKWI).encode()).status_code == 200
    assert upload(client, p["id"], "park.ino", SKETCH.encode()).status_code == 200
    got = analyse(client, p["id"])
    res = got["result"]
    assert [s["state"] for s in got["stages"]] == ["done", "done", "done", "skipped", "done", "done"]
    pm = {r["pin"]: r["status"] for r in res["domain_data"]["pin_map"]}
    assert pm["D13"] == "ok" and pm["D7"] == "mismatch" and pm["D9"] == "unused" and pm["A0"] == "mismatch"
    kinds = {f["kind"] for f in res["domain_data"]["findings"]}
    assert {"pin_mismatch", "pin_unused", "pin_match"} <= kinds
    assert res["claims"] and all(c["status"] in {"partially_verified", "unverified"} for c in res["claims"])   # no AI → never "verified"
    assert res["scores"]["overall"] is not None and 0 < res["scores"]["coverage"] <= 100
    assert res["scores"]["dimensions"]["functionality"]["status"] in {"scored", "insufficient_evidence"}
    assert len(res["report"]["sections"]) == 15
    assert res["report"]["sections"][3]["title"] == "Components & circuit"
    # same input → same job, same score
    again = client.post(f"/api/student/projects/{p['id']}/analyse", headers=H()).json()
    assert again["reused"] is True
    # PDF
    pdf = client.get(f"/api/student/projects/{p['id']}/analysis/report.pdf", headers=H())
    assert pdf.status_code == 200 and pdf.headers["content-type"] == "application/pdf" and pdf.content[:4] == b"%PDF"


def test_scoring_is_deterministic(client):
    from app.services.project_analysis.pipeline import run_job
    student()
    p = project(client)
    upload(client, p["id"], "diagram.json", json.dumps(WOKWI).encode())
    first = analyse(client, p["id"])["result"]["scores"]
    with Session(engine) as s:
        job = ProjectAnalysisJob(project_id=p["id"], candidate_id=1, input_hash="x", stages_json="[]")
        s.add(job)
        s.commit()
        s.refresh(job)
        jid = job.id
    run_job(jid)
    with Session(engine) as s:
        second = json.loads(s.get(ProjectAnalysisJob, jid).result_json)["scores"]
    assert first == second


def test_ai_claims_verification_and_ml_contradiction(client, monkeypatch):
    student()
    p = project(client, domain="ai_ml", desc="We trained a random forest classifier that reaches 95% accuracy on the test set using scikit-learn.")
    upload(client, p["id"], "train.ipynb", json.dumps(NOTEBOOK).encode())
    calls = []

    def fake_llm(system, user, operation, max_tokens=1500):
        calls.append(operation)
        if operation == "claims":
            return {"claims": [{"text": "reaches 95% accuracy on the test set", "type": "performance"},
                               {"text": "uses a random forest classifier", "type": "component"}]}
        ids = [line.split(" | ")[0] for line in user.split("EVIDENCE:\n")[1].splitlines()]
        model_ev = next(i for i in ids if "RandomForestClassifier" in user.split(i + " | ")[1].split("\n")[0])
        return {"results": [{"id": "c1", "status": "verified", "evidence_ids": ["ev999"], "reasoning": "trust me"},
                            {"id": "c2", "status": "verified", "evidence_ids": [model_ev], "reasoning": "Notebook builds it."}]}

    monkeypatch.setattr(ai, "text_ai_available", lambda: True)
    import app.services.project_analysis.claims as claims_mod
    monkeypatch.setattr(claims_mod, "llm_json", fake_llm)
    res = analyse(client, p["id"])["result"]
    st = {c["text"]: c for c in res["claims"]}
    assert st["reaches 95% accuracy on the test set"]["status"] == "contradicted"
    assert "71" in st["reaches 95% accuracy on the test set"]["reasoning"]
    assert st["uses a random forest classifier"]["status"] == "verified"
    assert calls == ["claims", "verify"] and res["ai_used"]
    risks = [f for f in res["domain_data"]["findings"] if f["kind"] == "ml_risk"]
    assert risks


def test_video_youtube_analysis_and_challenge_code(client, monkeypatch):
    student()
    p = project(client, video_url="https://youtu.be/dQw4w9WgXcQ?si=abc")
    assert p["video_url"] == "https://www.youtube.com/watch?v=dQw4w9WgXcQ"
    code = p["challenge_code"]
    spoken = " ".join({"0": "zero", "1": "one", "2": "two", "3": "three", "4": "four", "5": "five", "6": "six", "7": "seven", "8": "eight", "9": "nine"}[d] for d in code)
    monkeypatch.setattr(media, "gemini_available", lambda: True)
    seen = {}

    def fake_gemini(parts, operation, cache_key, **kw):
        seen["parts"] = parts
        return {"duration_s": 40, "segments": [
            {"start": "00:00", "end": "00:12", "visible": ["Arduino Uno", "HC-SR04 sensor"], "actions": ["hand moves closer"], "inputs": ["object at 10 cm"], "outputs": ["red LED on"],
             "spoken_summary": f"my verification code is {spoken}"}], "challenge_code_seen_or_heard": "yes"}
    monkeypatch.setattr(media, "gemini_json", fake_gemini)
    res = analyse(client, p["id"])["result"]
    assert seen["parts"][0]["file_data"]["file_uri"] == p["video_url"]
    assert res["video"]["challenge_code_found"] is True
    vid = [e for e in res["evidence"] if e["source_type"] == "video"]
    assert vid and all(e["confidence"] == "medium" for e in vid)
    assert res["scores"]["dimensions"]["functionality"]["score"] <= 6.0       # video-only evidence is capped


def test_quota_exhaustion_keeps_job_done(client, monkeypatch):
    student()
    p = project(client, video_url="https://www.youtube.com/watch?v=dQw4w9WgXcQ")
    monkeypatch.setattr(media, "gemini_available", lambda: True)
    monkeypatch.setattr(ai, "gemini_available", lambda: True)
    monkeypatch.setenv("GEMINI_API_KEY", "fake")
    monkeypatch.setenv("PROJECT_ANALYSIS_MAX_LLM_CALLS_PER_DAY", "0")
    got = analyse(client, p["id"])
    vstage = next(s for s in got["stages"] if s["name"] == "analyse_video")
    assert vstage["state"] == "skipped" and "limit" in vstage["message"]


def test_civil_safety_claims_never_verified(client, monkeypatch):
    student()
    p = project(client, domain="civil", desc="The G+2 residential frame is safe under seismic loads and complies with IS 456 for all beams.")
    monkeypatch.setattr(ai, "text_ai_available", lambda: True)
    import app.services.project_analysis.claims as claims_mod
    monkeypatch.setattr(claims_mod, "llm_json", lambda s, u, operation, max_tokens=0: (
        {"claims": [{"text": "The frame is safe under seismic loads", "type": "result"}]} if operation == "claims"
        else {"results": [{"id": "c1", "status": "verified", "evidence_ids": ["ev1"], "reasoning": "x"}]}))
    res = analyse(client, p["id"])["result"]
    assert res["claims"][0]["status"] == "unverified" and "not independently checked" in res["claims"][0]["reasoning"]


def test_file_validation_limits_and_ownership(client):
    student()
    student("other@example.com", "Other")
    p = project(client)
    assert upload(client, p["id"], "evil.exe", b"MZ").status_code == 400
    assert upload(client, p["id"], "fake.pdf", b"not a pdf").status_code == 400
    assert upload(client, p["id"], "bin.ino", b"\x00\x01\x02").status_code == 400
    ok = upload(client, p["id"], "a.ino", SKETCH.encode()).json()
    dup = upload(client, p["id"], "b.ino", SKETCH.encode()).json()
    assert dup["duplicate"] and dup["id"] == ok["id"]
    assert upload(client, p["id"], "c.ino", b"x", email="other@example.com").status_code == 404
    assert client.get(f"/api/student/projects/{p['id']}/analysis", headers=H("other@example.com")).status_code == 404
    for i in range(9):
        assert upload(client, p["id"], f"f{i}.ino", f"// {i}\n".encode()).status_code == 200
    assert upload(client, p["id"], "eleven.ino", b"// 11").status_code == 400
    assert client.delete(f"/api/student/projects/{p['id']}/files/{ok['id']}", headers=H()).status_code == 200
    bad = client.put(f"/api/student/projects/{p['id']}/video-frames", files=[("frames", ("f.jpg", b"notjpeg"))], data={"timestamps": ["00:01"]}, headers=H())
    assert bad.status_code == 400
    good = client.put(f"/api/student/projects/{p['id']}/video-frames", files=[("frames", ("f.jpg", b"\xff\xd8\xff" + b"0" * 100))], data={"timestamps": ["00:05"]}, headers=H())
    assert good.status_code == 200 and client.get(f"/api/student/projects/{p['id']}/files", headers=H()).json()["frames"][0]["timestamp"] == "00:05"


def test_invalid_domain_and_video_url(client):
    student()
    r = client.post("/api/student/projects", json={"title": "X", "domain": "astrology"}, headers=H())
    assert r.status_code == 422
    r = client.post("/api/student/projects", json={"title": "X", "video_url": "https://vimeo.com/123"}, headers=H())
    assert r.status_code == 422
    p = project(client)
    r = client.put(f"/api/student/projects/{p['id']}", json={"video_url": "https://www.youtube.com/shorts/dQw4w9WgXcQ"}, headers=H())
    assert r.json()["video_url"] == "https://www.youtube.com/watch?v=dQw4w9WgXcQ"
    old = p["challenge_code"]
    new = client.post(f"/api/student/projects/{p['id']}/challenge-code", headers=H()).json()["challenge_code"]
    assert len(new) == 4 and new.isdigit()
    assert old  # challenge codes exist from creation


def test_admin_and_recruiter_views(client):
    from app.db import User
    from app.auth import hash_password
    student()
    p = project(client, video_url="https://www.youtube.com/watch?v=dQw4w9WgXcQ")
    upload(client, p["id"], "diagram.json", json.dumps(WOKWI).encode())
    analyse(client, p["id"])
    with Session(engine) as s:
        s.add(User(name="Ad", email="adm@corelink.test", role="admin", password_hash=hash_password("AdminPass123!"), email_verified=True))
        s.commit()
    A = H("adm@corelink.test", "admin")
    full = client.get(f"/api/admin/projects/{p['id']}/analysis", headers=A).json()
    assert full["status"] == "done" and full["suggested_note"].startswith("Evidence score")
    assert client.get(f"/api/admin/projects/{p['id']}/analysis/report.pdf", headers=A).status_code == 200
    assert client.get(f"/api/admin/projects/{p['id']}/analysis", headers=H()).status_code in (401, 403)
    from app.api.project_analysis import recruiter_view
    with Session(engine) as s:
        view = recruiter_view(s, s.get(StudentProject, p["id"]))
    blob = json.dumps(view)
    assert p["challenge_code"] not in blob and "warnings" not in view and "Student says" not in blob
    assert view["scores"]["overall"] is not None and len(view["report"]["sections"]) == 14


def test_project_delete_removes_analysis(client):
    student()
    p = project(client)
    upload(client, p["id"], "park.ino", SKETCH.encode())
    analyse(client, p["id"])
    assert client.delete(f"/api/student/projects/{p['id']}", headers=H()).status_code == 200
    with Session(engine) as s:
        from sqlmodel import select
        from app.db import ProjectFile
        assert not s.exec(select(ProjectAnalysisJob)).all() and not s.exec(select(ProjectFile)).all()
