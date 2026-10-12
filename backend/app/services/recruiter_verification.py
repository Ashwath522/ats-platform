"""Recruiter / company business verification.

``verify_recruiter`` runs a set of cheap, explainable checks on a recruiter
access request and returns a 0-100 trust score, a verdict and the per-check
breakdown. Network checks (MX lookup, website fetch) run concurrently and
degrade to ``warn`` when the network is unavailable, so the function never
raises because of DNS/HTTP problems.
"""
from __future__ import annotations

import logging
import re
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from concurrent.futures import TimeoutError as FutureTimeout
from html import unescape
from typing import Optional
from urllib.parse import urlparse

import httpx

log = logging.getLogger("ats-platform.verification")

try:  # dnspython is a hard dependency in requirements, but stay importable without it
    import dns.exception
    import dns.resolver
except Exception:  # pragma: no cover
    dns = None  # type: ignore

DNS_TIMEOUT = 3.0
HTTP_TIMEOUT = 4.0
NETWORK_DEADLINE = 5.0
MAX_HTML_BYTES = 64 * 1024

DISPOSABLE_DOMAINS = frozenset({
    "mailinator.com", "mailinator.net", "mailinator2.com", "yopmail.com", "yopmail.net", "yopmail.fr",
    "guerrillamail.com", "guerrillamail.net", "guerrillamail.org", "guerrillamail.biz", "guerrillamail.de",
    "guerrillamailblock.com", "grr.la", "sharklasers.com", "spam4.me", "pokemail.net",
    "10minutemail.com", "10minutemail.net", "10minutemail.co.uk", "20minutemail.com", "temp-mail.org",
    "temp-mail.io", "tempmail.com", "tempmail.net", "tempmail.dev", "tempmailo.com", "tempr.email",
    "tempinbox.com", "temp-inbox.com", "throwawaymail.com", "trashmail.com", "trashmail.net", "trashmail.de",
    "trashmail.me", "getnada.com", "nada.email", "dispostable.com", "maildrop.cc", "mohmal.com",
    "mailnesia.com", "mintemail.com", "mytemp.email", "fakeinbox.com", "fakemail.net", "emailondeck.com",
    "spamgourmet.com", "spambox.us", "mailcatch.com", "moakt.com", "tmail.ws", "tmpmail.org", "tmpmail.net",
    "burnermail.io", "discard.email", "discardmail.com", "dropmail.me", "emailfake.com", "fakemailgenerator.com",
    "harakirimail.com", "inboxkitten.com", "mail-temp.com", "mailpoof.com", "mailsac.com", "mailtemp.net",
    "mvrht.net", "owlymail.com", "spamdecoy.net", "trbvm.com", "wegwerfmail.de", "33mail.com", "anonaddy.me",
    "byom.de", "cuvox.de", "dayrep.com", "einrot.com", "fleckens.hu", "gustr.com", "jourrapide.com",
    "rhyta.com", "superrito.com", "teleworm.us", "armyspy.com", "1secmail.com", "1secmail.net", "1secmail.org",
    "linshiyouxiang.net", "luxusmail.org", "getairmail.com", "zetmail.com", "mailforspam.com",
})

FREE_MAIL_DOMAINS = frozenset({
    "gmail.com", "googlemail.com", "yahoo.com", "yahoo.co.in", "yahoo.in", "yahoo.co.uk", "ymail.com",
    "rocketmail.com", "outlook.com", "outlook.in", "hotmail.com", "hotmail.co.uk", "hotmail.in", "live.com",
    "live.in", "msn.com", "icloud.com", "me.com", "mac.com", "aol.com", "proton.me", "protonmail.com",
    "protonmail.ch", "pm.me", "zoho.com", "zohomail.com", "zohomail.in", "rediffmail.com", "rediff.com",
    "yandex.com", "yandex.ru", "ya.ru", "gmx.com", "gmx.net", "gmx.de", "mail.com", "mail.ru", "inbox.com",
    "tutanota.com", "tuta.io", "fastmail.com", "hey.com", "qq.com", "163.com", "126.com", "sina.com",
    "web.de", "aim.com", "lycos.com", "hushmail.com", "mailfence.com",
})

# Common second-level public suffixes; enough for registrable-domain matching without a PSL dependency.
TWO_LEVEL_SUFFIXES = frozenset({
    "co.in", "net.in", "org.in", "firm.in", "gen.in", "ind.in", "ac.in", "edu.in", "res.in", "gov.in", "nic.in",
    "co.uk", "org.uk", "me.uk", "ltd.uk", "plc.uk", "ac.uk", "gov.uk", "net.uk",
    "com.au", "net.au", "org.au", "edu.au", "gov.au", "co.nz", "org.nz", "net.nz",
    "co.za", "org.za", "com.sg", "edu.sg", "com.my", "com.br", "com.mx", "com.ar", "co.jp", "ne.jp", "or.jp",
    "com.cn", "com.hk", "com.tw", "co.kr", "com.tr", "com.pk", "com.bd", "com.np", "com.lk", "co.id",
    "com.ph", "com.vn", "com.eg", "com.sa", "com.ng", "co.ke", "co.il", "com.ua",
})

COMPANY_SUFFIX_WORDS = frozenset({
    "pvt", "private", "ltd", "limited", "inc", "incorporated", "llp", "llc", "plc", "corp", "corporation",
    "co", "company", "technologies", "technology", "tech", "solutions", "services", "software", "systems",
    "labs", "group", "global", "india", "international", "the", "and", "of", "gmbh", "pte", "bv", "sa",
})

JUNK_NAMES = frozenset({
    "test", "testing", "tester", "asdf", "asdfgh", "qwerty", "abc", "abcd", "xyz", "aaa", "foo", "bar", "foobar",
    "admin", "user", "name", "demo", "sample", "dummy", "fake", "none", "null", "na", "hello", "hi", "temp",
})

GSTIN_RE = re.compile(r"^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$")
CIN_RE = re.compile(r"^[LU]\d{5}[A-Z]{2}\d{4}(PLC|PTC|FLC|FTC|GOI|SGC|NPL|GAP|GAT|ULL|ULT|OPC)\d{6}$")
EMAIL_RE = re.compile(
    r"^(?=.{3,254}$)[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]{1,64}@"
    r"(?:[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?\.)+[A-Za-z]{2,63}$"
)
LINKEDIN_COMPANY_RE = re.compile(
    r"^(?:https?://)?(?:[a-z]{2,3}\.)?linkedin\.com/company/[A-Za-z0-9_\-.%]+/?(?:[?#].*)?$", re.IGNORECASE
)
TITLE_RE = re.compile(r"<title[^>]*>(.*?)</title>", re.IGNORECASE | re.DOTALL)

GSTIN_CHARSET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ"

WEIGHTS = {
    "email_syntax": 10,
    "disposable": 15,
    "free_mail": 10,
    "mx": 10,
    "website": 15,
    "domain_match": 15,
    "company_name": 10,
    "gstin": 10,
    "cin": 10,
    "linkedin": 5,
    "phone": 5,
    "name": 5,
}
STATUS_FACTOR = {"pass": 1.0, "warn": 0.5, "fail": 0.0}
FAIL_SCORE_CAP = 70  # any failed check means the request can't be auto-"verified"


# --------------------------------------------------------------------------- helpers

def gstin_checksum_char(first14: str) -> str:
    """Official GSTIN check digit (Luhn mod-36 variant) for the first 14 chars."""
    total = 0
    for idx, ch in enumerate(first14.upper()):
        value = GSTIN_CHARSET.index(ch)
        product = value * (2 if idx % 2 else 1)
        total += product // 36 + product % 36
    return GSTIN_CHARSET[(36 - total % 36) % 36]


def validate_gstin(gstin: str) -> tuple[bool, str]:
    g = re.sub(r"\s+", "", gstin or "").upper()
    if not GSTIN_RE.match(g):
        return False, "GSTIN format is invalid (expected 15 characters, e.g. 27AAPFU0939F1ZV)"
    expected = gstin_checksum_char(g[:14])
    if g[14] != expected:
        return False, "GSTIN checksum does not match"
    return True, f"Valid GSTIN (state code {g[:2]}, PAN {g[2:12]})"


def validate_cin(cin: str) -> tuple[bool, str]:
    c = re.sub(r"\s+", "", cin or "").upper()
    if not CIN_RE.match(c):
        return False, "CIN format is invalid (expected 21 characters, e.g. U72900KA2015PTC082988)"
    listing = "listed" if c[0] == "L" else "unlisted"
    return True, f"Valid CIN format ({listing}, {c[6:8]}, incorporated {c[8:12]})"


def registrable_domain(host: Optional[str]) -> Optional[str]:
    if not host:
        return None
    host = host.strip().lower().rstrip(".")
    if "@" in host:
        host = host.rsplit("@", 1)[1]
    host = host.split(":", 1)[0]
    if host.startswith("www."):
        host = host[4:]
    labels = [label for label in host.split(".") if label]
    if len(labels) < 2:
        return host or None
    if len(labels) >= 3 and ".".join(labels[-2:]) in TWO_LEVEL_SUFFIXES:
        return ".".join(labels[-3:])
    return ".".join(labels[-2:])


def _domain_label(domain: Optional[str]) -> str:
    """'acme-corp.co.in' -> 'acmecorp'"""
    if not domain:
        return ""
    label = domain.split(".")[0]
    return re.sub(r"[^a-z0-9]", "", label.lower())


def normalize_website(url: Optional[str]) -> Optional[str]:
    url = (url or "").strip()
    if not url:
        return None
    if not re.match(r"^[a-z][a-z0-9+.-]*://", url, re.IGNORECASE):
        url = "https://" + url
    parsed = urlparse(url)
    if parsed.scheme.lower() not in {"http", "https"}:
        return None
    host = (parsed.hostname or "").lower()
    if not host or "." not in host or not re.match(r"^[a-z0-9.-]+$", host):
        return None
    path = parsed.path or "/"
    return f"https://{host}{path}"


def _company_tokens(company_name: str) -> list[str]:
    words = re.findall(r"[a-z0-9]+", (company_name or "").lower())
    core = [w for w in words if w not in COMPANY_SUFFIX_WORDS]
    return core or words


def _check(cid: str, label: str, status: str, detail: str) -> dict:
    return {"id": cid, "label": label, "status": status, "detail": detail, "weight": WEIGHTS[cid]}


# --------------------------------------------------------------------------- network probes

def _new_resolver():
    resolver = dns.resolver.Resolver()
    resolver.timeout = DNS_TIMEOUT
    resolver.lifetime = DNS_TIMEOUT
    return resolver


_SANITY_DOMAIN = "gmail.com"
_SANITY_TTL = 600.0
_sanity_cache: dict = {"value": None, "at": 0.0}
_sanity_lock = threading.Lock()


def _dns_trustworthy() -> bool:
    """Some sandboxes / captive networks answer NXDOMAIN for everything. Before
    treating NXDOMAIN as authoritative, confirm a well-known domain resolves."""
    if dns is None:
        return False
    with _sanity_lock:
        now = time.monotonic()
        if _sanity_cache["value"] is not None and now - _sanity_cache["at"] < _SANITY_TTL:
            return _sanity_cache["value"]
        try:
            _new_resolver().resolve(_SANITY_DOMAIN, "MX")
            value = True
        except Exception:
            value = False
        _sanity_cache.update(value=value, at=now)
        return value


def _probe_mx(domain: str) -> tuple[str, str]:
    """Returns (status, detail)."""
    if dns is None:
        return "warn", "Could not verify mail server (DNS library unavailable)"
    try:
        answers = _new_resolver().resolve(domain, "MX")
        hosts = sorted(str(r.exchange).rstrip(".") for r in answers)
        if not hosts:
            return "warn", f"No MX records found for {domain}"
        return "pass", f"Mail server found ({hosts[0]})"
    except dns.resolver.NXDOMAIN:
        if not _dns_trustworthy():
            return "warn", "Could not verify mail server (DNS unavailable)"
        return "fail", f"Email domain {domain} does not exist"
    except dns.resolver.NoAnswer:
        return "warn", f"{domain} has no MX records; it may not receive email"
    except Exception as exc:  # timeout, no nameservers, network blocked
        log.info("MX lookup for %s failed: %s", domain, type(exc).__name__)
        return "warn", "Could not verify mail server (DNS lookup failed)"


def _probe_host_exists(host: str) -> Optional[bool]:
    """False only on authoritative NXDOMAIN; None when unknown."""
    if dns is None:
        return None
    try:
        _new_resolver().resolve(host, "A")
        return True
    except dns.resolver.NXDOMAIN:
        return False if _dns_trustworthy() else None
    except dns.resolver.NoAnswer:
        return True  # name exists (maybe AAAA/CNAME only)
    except Exception:
        return None


def _probe_website(url: str) -> dict:
    """Fetch the site. Returns {ok, status_code, final_url, title, error}."""
    result = {"ok": False, "status_code": None, "final_url": None, "title": None, "error": None}
    try:
        with httpx.Client(
            timeout=httpx.Timeout(HTTP_TIMEOUT),
            follow_redirects=True,
            max_redirects=5,
            headers={"User-Agent": "Mozilla/5.0 (compatible; CoreLinkVerifier/1.0)"},
        ) as client:
            with client.stream("GET", url) as response:
                result["status_code"] = response.status_code
                result["final_url"] = str(response.url)
                chunks, size = [], 0
                ctype = response.headers.get("content-type", "")
                if "html" in ctype.lower() or not ctype:
                    for chunk in response.iter_bytes():
                        chunks.append(chunk)
                        size += len(chunk)
                        if size >= MAX_HTML_BYTES:
                            break
                html = b"".join(chunks)[:MAX_HTML_BYTES].decode(response.encoding or "utf-8", errors="ignore")
                match = TITLE_RE.search(html)
                if match:
                    result["title"] = re.sub(r"\s+", " ", unescape(match.group(1))).strip()[:200]
                result["ok"] = response.status_code < 400
    except httpx.TimeoutException:
        result["error"] = "timeout"
    except httpx.ConnectError as exc:
        msg = str(exc).lower()
        if any(s in msg for s in ("name or service not known", "nodename nor servname", "no address associated",
                                  "getaddrinfo failed", "name does not resolve")):
            result["error"] = "nxdomain" if _dns_trustworthy() else "dns"
        elif "ssl" in msg or "certificate" in msg:
            result["error"] = "ssl"
        else:
            result["error"] = "connect"
    except httpx.HTTPError as exc:
        result["error"] = type(exc).__name__
    except Exception as exc:  # pragma: no cover
        result["error"] = type(exc).__name__
    return result


# --------------------------------------------------------------------------- main entry point

def verify_recruiter(
    name: str,
    email: str,
    phone: str,
    company_name: Optional[str] = None,
    company_website: Optional[str] = None,
    designation: Optional[str] = None,
    gstin: Optional[str] = None,
    cin: Optional[str] = None,
    linkedin_url: Optional[str] = None,
    *,
    network: bool = True,
) -> dict:
    name = (name or "").strip()
    email = (email or "").strip().lower()
    phone = (phone or "").strip()
    company_name = (company_name or "").strip() or None
    designation = (designation or "").strip() or None
    checks: list[dict] = []
    blocked = False
    block_reason: Optional[str] = None

    # 1. Email syntax
    email_ok = bool(EMAIL_RE.match(email))
    email_domain = email.rsplit("@", 1)[1] if email_ok else None
    email_reg = registrable_domain(email_domain) if email_domain else None
    if email_ok:
        checks.append(_check("email_syntax", "Email address format", "pass", "Email address is well formed"))
    else:
        checks.append(_check("email_syntax", "Email address format", "fail", "Email address is not valid"))
        blocked, block_reason = True, "Please enter a valid email address."

    # 2. Disposable
    is_disposable = bool(email_domain) and (email_domain in DISPOSABLE_DOMAINS or email_reg in DISPOSABLE_DOMAINS)
    if not email_ok:
        checks.append(_check("disposable", "Not a disposable inbox", "skip", "Email address is invalid"))
    elif is_disposable:
        checks.append(_check("disposable", "Not a disposable inbox", "fail",
                             f"{email_domain} is a disposable / temporary email provider"))
        blocked = True
        block_reason = "Disposable or temporary email addresses are not allowed. Please use your work email."
    else:
        checks.append(_check("disposable", "Not a disposable inbox", "pass", "Not a known temporary email provider"))

    # 3. Free webmail
    is_free = bool(email_domain) and (email_domain in FREE_MAIL_DOMAINS or email_reg in FREE_MAIL_DOMAINS)
    if not email_ok:
        checks.append(_check("free_mail", "Company email domain", "skip", "Email address is invalid"))
    elif is_free:
        checks.append(_check("free_mail", "Company email domain", "warn",
                             f"{email_domain} is a personal webmail domain; a company email is preferred"))
    else:
        checks.append(_check("free_mail", "Company email domain", "pass", f"Uses a company domain ({email_domain})"))

    # 5 prep: website
    website = normalize_website(company_website)
    website_host = urlparse(website).hostname if website else None
    website_reg = registrable_domain(website_host) if website_host else None

    # Network probes, concurrently
    mx_result: Optional[tuple[str, str]] = None
    host_exists: Optional[bool] = None
    site: Optional[dict] = None
    if network and (email_domain and not is_disposable or website):
        pool = ThreadPoolExecutor(max_workers=3, thread_name_prefix="verify")
        deadline = time.monotonic() + NETWORK_DEADLINE
        try:
            f_mx = pool.submit(_probe_mx, email_domain) if email_domain and not is_disposable else None
            f_host = pool.submit(_probe_host_exists, website_host) if website else None
            f_site = pool.submit(_probe_website, website) if website else None
            for fut, kind in ((f_mx, "mx"), (f_host, "host"), (f_site, "site")):
                if fut is None:
                    continue
                try:
                    value = fut.result(timeout=max(0.05, deadline - time.monotonic()))
                except FutureTimeout:
                    value = None
                except Exception as exc:  # pragma: no cover
                    log.info("verification probe %s failed: %s", kind, exc)
                    value = None
                if kind == "mx":
                    mx_result = value or ("warn", "Could not verify mail server (lookup timed out)")
                elif kind == "host":
                    host_exists = value
                else:
                    site = value or {"ok": False, "error": "timeout", "title": None, "status_code": None}
        finally:
            # never wait for stragglers past the deadline
            pool.shutdown(wait=False, cancel_futures=True)

    # 4. MX
    if not network:
        checks.append(_check("mx", "Email domain accepts mail", "skip", "Network checks disabled"))
    elif not email_domain or is_disposable:
        checks.append(_check("mx", "Email domain accepts mail", "skip", "Not applicable"))
    else:
        status, detail = mx_result or ("warn", "Could not verify mail server")
        checks.append(_check("mx", "Email domain accepts mail", status, detail))

    # 5. Website reachable
    title = None
    if company_website and not website:
        checks.append(_check("website", "Company website", "fail", "Website URL is not valid"))
    elif not website:
        checks.append(_check("website", "Company website", "warn", "No company website provided"))
    elif not network:
        checks.append(_check("website", "Company website", "skip", "Network checks disabled"))
    else:
        site = site or {}
        title = site.get("title")
        if host_exists is False or site.get("error") == "nxdomain":
            checks.append(_check("website", "Company website", "fail", f"{website_host} does not exist (no DNS record)"))
        elif site.get("ok"):
            extra = f' - "{title}"' if title else ""
            checks.append(_check("website", "Company website", "pass",
                                 f"{website_host} is reachable over HTTPS (HTTP {site.get('status_code')}){extra}"))
        elif site.get("status_code"):
            checks.append(_check("website", "Company website", "warn",
                                 f"{website_host} responded with HTTP {site.get('status_code')}"))
        elif site.get("error") == "ssl":
            checks.append(_check("website", "Company website", "warn", f"{website_host} has no valid HTTPS certificate"))
        else:
            checks.append(_check("website", "Company website", "warn",
                                 f"Could not reach {website_host} right now ({site.get('error') or 'network error'})"))

    # 6. Email domain matches website
    if not email_ok or is_disposable:
        checks.append(_check("domain_match", "Email matches company website", "skip", "Not applicable"))
    elif not website_reg:
        checks.append(_check("domain_match", "Email matches company website", "warn",
                             "No company website to compare the email domain with"))
    elif is_free:
        checks.append(_check("domain_match", "Email matches company website", "warn",
                             f"Personal email can't be matched to {website_reg}"))
    elif email_reg == website_reg:
        checks.append(_check("domain_match", "Email matches company website", "pass",
                             f"Email domain matches {website_reg}"))
    else:
        checks.append(_check("domain_match", "Email matches company website", "warn",
                             f"Email domain {email_reg} differs from website {website_reg}"))

    # 7. Company name vs website title/domain
    if not company_name:
        checks.append(_check("company_name", "Company name matches", "warn", "No company name provided"))
    else:
        tokens = [t for t in _company_tokens(company_name) if len(t) >= 2]
        compact = "".join(tokens)
        sources = []
        if title:
            sources.append(("website title", title.lower()))
        if website_reg:
            sources.append(("website domain", _domain_label(website_reg)))
        if email_reg and not is_free and not is_disposable:
            sources.append(("email domain", _domain_label(email_reg)))
        if not sources or not compact:
            checks.append(_check("company_name", "Company name matches", "skip",
                                 "Nothing to compare the company name against"))
        else:
            matched = None
            for label, text_value in sources:
                text_compact = re.sub(r"[^a-z0-9]", "", text_value)
                significant = [t for t in tokens if len(t) >= 3]
                if (
                    (len(compact) >= 3 and compact in text_compact)
                    or (label != "website title" and len(text_compact) >= 3 and text_compact in compact)
                    or (significant and sum(t in text_compact for t in significant) * 2 >= len(significant) + 1)
                ):
                    matched = label
                    break
            if matched:
                checks.append(_check("company_name", "Company name matches", "pass",
                                     f'"{company_name}" matches the {matched}'))
            else:
                checks.append(_check("company_name", "Company name matches", "warn",
                                     f'"{company_name}" was not found in the website title or domain'))

    # 8. GSTIN
    if not (gstin or "").strip():
        checks.append(_check("gstin", "GSTIN", "skip", "Not provided"))
    else:
        ok, detail = validate_gstin(gstin)
        checks.append(_check("gstin", "GSTIN", "pass" if ok else "fail", detail))

    # 9. CIN
    if not (cin or "").strip():
        checks.append(_check("cin", "Company Identification Number (CIN)", "skip", "Not provided"))
    else:
        ok, detail = validate_cin(cin)
        checks.append(_check("cin", "Company Identification Number (CIN)", "pass" if ok else "fail", detail))

    # 10. LinkedIn company page
    if not (linkedin_url or "").strip():
        checks.append(_check("linkedin", "LinkedIn company page", "skip", "Not provided"))
    elif LINKEDIN_COMPANY_RE.match(linkedin_url.strip()):
        checks.append(_check("linkedin", "LinkedIn company page", "pass", "Looks like a LinkedIn company page URL"))
    else:
        checks.append(_check("linkedin", "LinkedIn company page", "warn",
                             "Expected a URL like linkedin.com/company/<name>"))

    # 11. Phone
    stripped = re.sub(r"[\s\-().]", "", phone)
    has_plus = stripped.startswith("+")
    digits = stripped.lstrip("+")
    if not digits.isdigit():
        checks.append(_check("phone", "Phone number", "warn", "Phone number contains invalid characters"))
    elif (len(digits) == 10 and digits[0] in "6789") or (
        len(digits) == 12 and digits.startswith("91") and digits[2] in "6789"
    ):
        checks.append(_check("phone", "Phone number", "pass", "Valid Indian mobile number"))
    elif has_plus and 10 <= len(digits) <= 15:
        checks.append(_check("phone", "Phone number", "pass", "Valid international number"))
    elif 10 <= len(digits) <= 15:
        checks.append(_check("phone", "Phone number", "warn", "Add your country code (e.g. +91) so we can verify the number"))
    else:
        checks.append(_check("phone", "Phone number", "warn", "Phone number should have 10-15 digits"))

    # 12. Name sanity
    local_part = email.split("@", 1)[0] if "@" in email else ""
    name_clean = re.sub(r"[^a-z]", "", name.lower())
    local_clean = re.sub(r"[^a-z]", "", local_part.lower())
    if len(name) < 2 or not re.search(r"[A-Za-z]", name):
        checks.append(_check("name", "Recruiter name", "warn", "Name looks too short or has no letters"))
    elif name_clean in JUNK_NAMES or (len(name_clean) >= 3 and len(set(name_clean)) == 1):
        checks.append(_check("name", "Recruiter name", "warn", "Name looks like a placeholder"))
    elif local_clean in JUNK_NAMES:
        checks.append(_check("name", "Recruiter name", "warn", f'Email "{local_part}@" looks like a placeholder address'))
    else:
        checks.append(_check("name", "Recruiter name", "pass", "Name looks genuine"))

    # Score
    total = sum(c["weight"] for c in checks if c["status"] != "skip")
    earned = sum(c["weight"] * STATUS_FACTOR[c["status"]] for c in checks if c["status"] != "skip")
    score = int(round(100 * earned / total)) if total else 0
    if any(c["status"] == "fail" for c in checks):
        score = min(score, FAIL_SCORE_CAP)
    if blocked:
        score = min(score, 20)
        verdict = "high_risk"
    elif score >= 75:
        verdict = "verified"
    elif score >= 45:
        verdict = "review"
    else:
        verdict = "high_risk"

    return {
        "score": score,
        "verdict": verdict,
        "blocked": blocked,
        "block_reason": block_reason,
        "checks": checks,
        "domain": email_reg,
        "website_domain": website_reg,
        "website_title": title,
    }
