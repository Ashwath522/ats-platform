"""Static source-code reading (never executed): Arduino/C/C++, Python, JS/TS, Java.

Comments and string literals are stripped before matching, so a pin mentioned
in a comment is never treated as used.
"""
from __future__ import annotations

import re
from typing import Dict, List

from .base import Extracted, clip

LIB_HINTS = {
    "dht": "DHT temperature/humidity sensor", "servo": "servo motor", "liquidcrystal": "character LCD",
    "wire": "I²C bus", "spi": "SPI bus", "wifi": "Wi-Fi", "esp8266wifi": "Wi-Fi (ESP8266)", "bluetoothserial": "Bluetooth",
    "pubsubclient": "MQTT client", "onewire": "1-Wire bus", "dallastemperature": "DS18B20 temperature sensor",
    "adafruit_ssd1306": "OLED display (SSD1306)", "mpu6050": "MPU6050 IMU", "newping": "ultrasonic distance sensor",
    "hx711": "HX711 load-cell amplifier", "mfrc522": "RFID reader (MFRC522)", "softwareserial": "software serial port",
    "stepper": "stepper motor", "accelstepper": "stepper motor", "irremote": "IR receiver", "adafruit_neopixel": "addressable LEDs",
    "tinygps": "GPS module", "blynksimpleesp8266": "Blynk IoT dashboard", "blynksimpleesp32": "Blynk IoT dashboard",
    "firebaseesp32": "Firebase", "httpclient": "HTTP client", "esp32servo": "servo motor", "rtclib": "real-time clock",
}

_COMMENT = re.compile(r"//[^\n]*|/\*.*?\*/", re.S)
_PY_COMMENT = re.compile(r"#[^\n]*")
_STRING = re.compile(r'"(?:\\.|[^"\\\n])*"|\'(?:\\.|[^\'\\\n])*\'')


def strip_c(src: str) -> str:
    # Keep #include lines intact before removing strings.
    src = _COMMENT.sub(" ", src)
    out = []
    for line in src.splitlines():
        out.append(line if line.lstrip().startswith("#include") else _STRING.sub('""', line))
    return "\n".join(out)


def _norm_pin(token: str, aliases: Dict[str, str]) -> str | None:
    t = token.strip()
    t = aliases.get(t, t)
    if re.fullmatch(r"\d{1,2}", t):
        return f"D{int(t)}"
    m = re.fullmatch(r"(?:A)(\d{1,2})", t)
    if m:
        return f"A{int(m.group(1))}"
    m = re.fullmatch(r"(?:GPIO_NUM_|GPIO|D)(\d{1,2})", t)
    if m:
        return f"D{int(m.group(1))}"
    if t == "LED_BUILTIN":
        return "D13"
    return None


def parse_arduino(name: str, src: str) -> Extracted:
    ex = Extracted(kind="arduino")
    clean = strip_c(src)
    includes = re.findall(r'#include\s*[<"]([^>"]+)[>"]', clean)
    aliases: Dict[str, str] = {}
    for m in re.finditer(r"#define\s+(\w+)\s+(\w+)", clean):
        aliases[m.group(1)] = m.group(2)
    for m in re.finditer(r"(?:const\s+)?(?:static\s+)?(?:u?int(?:8|16|32)?_t|int|byte|uint8_t|short|unsigned\s+int)\s+(\w+)\s*=\s*(\w+)\s*;", clean):
        aliases.setdefault(m.group(1), m.group(2))
    # resolve chained aliases once
    for k, v in list(aliases.items()):
        aliases[k] = aliases.get(v, v)

    pins: Dict[str, Dict] = {}

    def use(tok: str, how: str, line: int):
        p = _norm_pin(tok, aliases)
        if p:
            entry = pins.setdefault(p, {"pin": p, "uses": [], "lines": []})
            if how not in entry["uses"]:
                entry["uses"].append(how)
            entry["lines"].append(line)

    calls = {
        "pinMode": None, "digitalWrite": "digital output", "digitalRead": "digital input", "analogRead": "analog input",
        "analogWrite": "PWM output", "attachInterrupt": "interrupt", "tone": "tone output", "pulseIn": "pulse input",
    }
    for ln, line in enumerate(clean.splitlines(), 1):
        for fn, how in calls.items():
            for m in re.finditer(rf"\b{fn}\s*\(\s*([\w]+)\s*(?:,\s*(\w+))?", line):
                arg = m.group(1)
                if fn == "attachInterrupt":
                    im = re.search(r"digitalPinToInterrupt\s*\(\s*(\w+)", line)
                    arg = im.group(1) if im else arg
                if fn == "pinMode":
                    mode = (m.group(2) or "").upper()
                    how2 = "output" if mode == "OUTPUT" else ("input" if "INPUT" in mode else "configured")
                    use(arg, how2, ln)
                else:
                    use(arg, how, ln)
        for m in re.finditer(r"\.attach\s*\(\s*(\w+)", line):
            use(m.group(1), "servo signal", ln)
        for m in re.finditer(r"\b(?:DHT|NewPing|SoftwareSerial|HX711)\s+\w+\s*\(\s*(\w+)(?:\s*,\s*(\w+))?", line):
            use(m.group(1), "sensor/peripheral", ln)
            if m.group(2):
                use(m.group(2), "sensor/peripheral", ln)

    bauds = sorted(set(re.findall(r"Serial\d?\.begin\s*\(\s*(\d+)", clean)))
    comms = []
    low = clean.lower()
    for key, label in (("wifi.begin", "Wi-Fi"), ("mqtt", "MQTT"), ("http", "HTTP"), ("bluetooth", "Bluetooth"), ("ble", "BLE"),
                       ("wire.begin", "I²C"), ("spi.begin", "SPI"), ("lora", "LoRa"), ("espnow", "ESP-NOW")):
        if key in low and label not in comms:
            comms.append(label)
    mqtt_topics = sorted(set(re.findall(r'(?:publish|subscribe)\s*\(\s*"([^"]{1,80})"', _COMMENT.sub(" ", src))))
    has_setup = bool(re.search(r"\bvoid\s+setup\s*\(", clean))
    has_loop = bool(re.search(r"\bvoid\s+loop\s*\(", clean))
    uses_delay = len(re.findall(r"\bdelay\s*\(", clean))
    uses_millis = "millis(" in clean

    loc = {"file": name}
    if includes:
        ex.add(f"{name} includes libraries: {clip(includes)}", locator=loc, key="includes")
    for inc in includes:
        hint = LIB_HINTS.get(re.sub(r"\.h(pp)?$", "", inc.lower()))
        if hint:
            ex.add(f"{name} uses the {inc} library (typically for {hint})", locator=loc, confidence="medium", key=f"lib:{inc}")
    for p in sorted(pins, key=lambda x: (x[0], int(x[1:]))):
        e = pins[p]
        ex.add(f"Code uses pin {p} as {', '.join(e['uses'])} ({name}, line {e['lines'][0]})",
               locator={"file": name, "line": e["lines"][0]}, key=f"pin:{p}")
    if bauds:
        ex.add(f"{name} opens serial at {', '.join(bauds)} baud", locator=loc)
    if comms:
        ex.add(f"{name} uses communication: {', '.join(comms)}", locator=loc, key="comms")
    if mqtt_topics:
        ex.add(f"{name} publishes/subscribes MQTT topics: {clip(mqtt_topics, 8)}", locator=loc, key="mqtt")
    if name.endswith(".ino") or has_setup:
        ex.add(f"{name}: setup() {'present' if has_setup else 'missing'}, loop() {'present' if has_loop else 'missing'}"
               + (f", {uses_delay} delay() call(s)" if uses_delay else "") + (", uses millis() timing" if uses_millis else ""), locator=loc)
    ex.data = {"type": "arduino", "file": name, "includes": includes, "pins": list(pins.values()), "aliases": aliases,
               "comms": comms, "mqtt_topics": mqtt_topics, "setup": has_setup, "loop": has_loop, "lines": src.count("\n") + 1,
               "todo": len(re.findall(r"\b(TODO|FIXME|XXX)\b", src))}
    return ex


ROUTE_PATTERNS = [
    (r"@(?:app|router|bp|blueprint)\.(get|post|put|patch|delete|route)\(\s*['\"]([^'\"]+)", "Python"),
    (r"\b(?:app|router)\.(get|post|put|patch|delete|use)\(\s*['\"`]([^'\"`]+)", "JavaScript"),
    (r"@(Get|Post|Put|Patch|Delete|Request)Mapping\(\s*(?:value\s*=\s*)?\"([^\"]+)", "Java"),
]


def parse_general(name: str, src: str, lang: str) -> Extracted:
    ex = Extracted(kind="source")
    if lang == "python":
        imports = re.findall(r"^\s*(?:from\s+([\w.]+)\s+import|import\s+([\w.]+))", src, re.M)
        imports = sorted({(a or b).split(".")[0] for a, b in imports})
        body = _PY_COMMENT.sub("", src)
    elif lang == "java":
        imports = sorted({m.split(".")[1] if m.count(".") > 1 else m for m in re.findall(r"^\s*import\s+([\w.]+)", src, re.M)})
        body = strip_c(src)
    else:
        imports = sorted(set(re.findall(r"""(?:from\s+['"]([^'"]+)['"]|require\(\s*['"]([^'"]+)['"]\))""", src)))
        imports = sorted({(a or b) for a, b in imports if (a or b) and not (a or b).startswith(".")})
        body = strip_c(src)
    routes = []
    for pat, _ in ROUTE_PATTERNS:
        for m in re.finditer(pat, src):
            routes.append(f"{m.group(1).upper()} {m.group(2)}")
    funcs = len(re.findall(r"^\s*(?:async\s+)?def\s+\w+|function\s+\w+\s*\(|=>\s*{", body, re.M))
    empty = len(re.findall(r"def\s+\w+\([^)]*\)\s*(?:->\s*[^:]+)?:\s*\n\s+(?:pass|\.\.\.)\s*$", src, re.M))
    todo = len(re.findall(r"\b(TODO|FIXME|XXX)\b", src))
    lines = src.count("\n") + 1
    loc = {"file": name}
    if imports:
        ex.add(f"{name} imports: {clip(imports)}", locator=loc, key="imports")
    if routes:
        ex.add(f"{name} defines API routes: {clip(routes, 10)}", locator=loc, key="routes")
    ex.add(f"{name}: {lines} lines, {funcs} functions" + (f", {todo} TODO/FIXME markers" if todo else "")
           + (f", {empty} empty function(s)" if empty else ""), locator=loc)
    ex.data = {"type": "source", "file": name, "lang": lang, "imports": imports, "routes": routes, "lines": lines,
               "functions": funcs, "todo": todo, "empty_functions": empty, "is_test": bool(re.search(r"(^|/)(test_|tests?/|.*\.test\.|.*_test\.)", name.lower()))}
    return ex


def parse_code(name: str, text: str, ext: str) -> Extracted:
    if ext in {".ino", ".c", ".cpp", ".h", ".hpp"} and (ext == ".ino" or re.search(r"\b(pinMode|digitalWrite|analogRead|Serial\.begin|setup\s*\()", text)):
        return parse_arduino(name, text)
    lang = {".py": "python", ".js": "javascript", ".ts": "javascript", ".java": "java"}.get(ext, "c")
    return parse_general(name, text, lang)
