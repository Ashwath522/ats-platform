from typing import Optional
import os
import time
import numpy as np
import logging

logger = logging.getLogger(__name__)
from app.services.keyword_extractor import extract_keywords, match_keywords
from app.services.embeddings import EmbeddingModel
from app.services.groq_client import GroqClient, RateLimitError as GRateLimitError
from app.services.gemini_client import GeminiClient, RateLimitError as GemRateLimitError

def cosine_similarity(a, b) -> float:
    a = np.array(a)
    b = np.array(b)
    na = np.linalg.norm(a)
    nb = np.linalg.norm(b)
    if na == 0 or nb == 0: return 0.0
    return float(np.dot(a, b) / (na * nb))

def _generate_conclusion(gemini_result: dict, groq_result: dict, client) -> str:
    if client is None: return ""
    def _block(name, res):
        if not res: return ""
        return f"\n{name} ANALYSIS:\n- Project Score: {res.get('project_score', 0)}/100\n- Summary: {res.get('project_summary', '')}\n- Recommendation: {res.get('recommendation', '')}\n"
    analyses = _block("GEMINI", gemini_result) + _block("GROQ", groq_result)
    if not analyses.strip(): return ""
    prompt = f"You are a senior technical recruiter. AI systems analyzed a student's portfolio:\n{analyses}\nWrite a FINAL CONCLUSION (3-5 sentences) that:\n1. Compares and contrasts the analyses above\n2. Identifies the strongest insights from each\n3. Gives a definitive, balanced hiring recommendation\nPlain text only. Be specific and decisive."
    try:
        if isinstance(client, GroqClient) and client._available:
            resp = client.client.chat.completions.create(
                model=client.model,
                messages=[{"role": "user", "content": prompt}],
                temperature=0.3,
                max_tokens=400,
            )
            return (resp.choices[0].message.content or "").strip()
        elif isinstance(client, GeminiClient) and client._available:
            resp = client.model.generate_content(prompt)
            return (resp.text or "").strip()
    except Exception:
        pass
    return ""

def _format_result_text(result: dict, api_name: str) -> str:
    if not result: return f"{api_name} analysis was unavailable."
    lines = [f"=== {api_name} Analysis ===", f"Project Score: {result.get('project_score', 0)}/100", f"Content Quality: {result.get('content_quality', 0)}/10", "", f"Summary:\n{result.get('project_summary', 'N/A')}"]
    if result.get('technical_analysis'): lines += ["", f"Technical Analysis:\n{result.get('technical_analysis')}"]
    if result.get('skills_matched_detail'): lines += ["", f"Skills Matched (Detail):\n{result.get('skills_matched_detail')}"]
    if result.get('skills_gap_detail'): lines += ["", f"Skills Gap:\n{result.get('skills_gap_detail')}"]
    if result.get('strengths'): lines += ["", f"Strengths:\n{result.get('strengths')}"]
    lines += ["", f"Recommendation:\n{result.get('recommendation', 'N/A')}", "", f"Skills Matched: {', '.join(result.get('skills_matched', [])) or 'None identified'}", f"Skills Missing: {', '.join(result.get('skills_missing', [])) or 'None identified'}"]
    return "\n".join(lines)

def count_words(result: dict) -> int:
    fields = ['project_summary', 'technical_analysis', 'strengths', 'recommendation', 'skills_matched_detail', 'skills_gap_detail']
    total = 0
    for f in fields:
        val = result.get(f, '')
        if val: total += len(str(val).split())
    return total

def build_full_project_text(project_texts: list) -> str:
    valid = [t.strip() for t in project_texts if t and len(t.strip()) > 20]
    if not valid: return ""
    combined = "\n\n=====\n\n".join(valid)
    if len(combined) > 8000:
        combined = combined[:8000] + "\n\n[Content truncated]"
    return combined

def score_student_job(student: dict, project_texts: list, job: dict):
    combined = build_full_project_text(project_texts)
    if not combined: combined = f"Student: {student.get('name','Unknown')}\nBranch: {student.get('branch','Unknown')}\nNo project content available."

    try:
        student_kw = extract_keywords(combined)
        jd_kw = job.get("extracted_keywords") or []
        kw_result = match_keywords(student_kw, jd_kw)
        keyword_score = kw_result["score"]
    except Exception:
        kw_result = {"matched": [], "missing": []}
        keyword_score = 0.0

    try:
        model = EmbeddingModel.get()
        
        # Sample chars from each parsed file instead of just the first 1000 chars of the combined text
        semantic_parts = []
        valid_texts = [t.strip() for t in project_texts if t and len(t.strip()) > 20]
        chars_per_file = max(200, 1000 // len(valid_texts)) if valid_texts else 1000
        for text in valid_texts:
            semantic_parts.append(text[:chars_per_file])
        semantic_combined = "\n".join(semantic_parts)[:1000]

        s_vec = model.embed_text(semantic_combined if semantic_combined else combined[:1000])
        j_vec = model.embed_text((job.get("full_jd_text") or "")[:1000])
        semantic_score = round(cosine_similarity(s_vec, j_vec) * 100, 1)
    except Exception as e:
        logger.error(f"Embedding error: {e}")
        semantic_score = 0.0

    groq_key = os.environ.get("GROQ_API_KEY")
    groq_result = None
    if groq_key:
        try:
            gc = GroqClient(groq_key)
            groq_result = gc.analyze_project(student, combined, job)
        except Exception as e:
            logger.error(f"[SCORER] Groq exception: {e}")

    gemini_key = os.environ.get("GEMINI_API_KEY")
    gemini_result = None
    if gemini_key:
        try:
            gmc = GeminiClient(gemini_key)
            gemini_result = gmc.analyze_project(student, combined, job)
        except Exception as e:
            logger.error(f"[SCORER] Gemini exception: {e}")

    groq_words = count_words(groq_result) if groq_result else 0
    gemini_words = count_words(gemini_result) if gemini_result else 0

    def _has_useful_content(r: dict) -> bool:
        if not r: return False
        return (r.get('project_score', 0) > 0 or r.get('content_quality', 0) > 0 or count_words(r) >= 20)

    candidates = []
    if _has_useful_content(groq_result): candidates.append(('groq', groq_result, groq_words))
    if _has_useful_content(gemini_result): candidates.append(('gemini', gemini_result, gemini_words))

    if candidates:
        best_name, best_result, best_words = max(candidates, key=lambda x: (x[1].get('content_quality', 0), x[2]))
        api_used = best_name
    else:
        best_result = {
            'project_score': round(keyword_score * 0.6 + semantic_score * 0.4, 1),
            'skills_matched': kw_result.get('matched', []),
            'skills_missing': kw_result.get('missing', []),
            'project_summary': 'Scored via keyword+semantic fallback (AI unavailable).',
            'technical_analysis': 'AI analysis unavailable.',
            'skills_matched_detail': '',
            'skills_gap_detail': '',
            'strengths': '',
            'recommendation': 'Manual review required.',
            'risk_notes': 'AI analysis unavailable.',
            'content_quality': 0,
        }
        api_used = 'fallback'

    conclusion = ""
    if groq_result or gemini_result:
        conclusion_client = None
        if groq_key: conclusion_client = GroqClient(groq_key)
        elif gemini_key: conclusion_client = GeminiClient(gemini_key)
        if conclusion_client:
            conclusion = _generate_conclusion(gemini_result, groq_result, conclusion_client)

    project_score = float(best_result.get('project_score', 0) or 0)
    ats_score     = float(student.get("ats_score", 0) or 0)
    final_score   = round((0.40 * ats_score) + (0.60 * project_score), 1)
    priority = "High" if final_score >= 75 else "Medium" if final_score >= 50 else "Low"

    return {
        'ats_score': ats_score,
        'keyword_score': keyword_score,
        'semantic_score': semantic_score,
        'project_score': project_score,
        'final_score': final_score,
        'skills_matched': best_result.get('skills_matched', []),
        'skills_missing': best_result.get('skills_missing', []),
        'project_summary': best_result.get('project_summary', ''),
        'technical_analysis': best_result.get('technical_analysis', ''),
        'skills_matched_detail': best_result.get('skills_matched_detail', ''),
        'skills_gap_detail': best_result.get('skills_gap_detail', ''),
        'strengths': best_result.get('strengths', ''),
        'ai_recommendation': best_result.get('recommendation', ''),
        'risk_notes': best_result.get('risk_notes', ''),
        'priority_level': priority,
        'api_used': api_used,
        'groq_word_count': groq_words,
        'gemini_word_count': gemini_words,
        'groq_raw': _format_result_text(groq_result, "Groq") if groq_result else "",
        'gemini_raw': _format_result_text(gemini_result, "Gemini") if gemini_result else "",
        'final_conclusion': conclusion,
        'groq_quality': (groq_result.get('content_quality', 0) or 0) if groq_result else 0,
        'gemini_quality': (gemini_result.get('content_quality', 0) or 0) if gemini_result else 0,
    }

def evaluate_profile_project(description: str, project_texts: list) -> dict:
    combined = build_full_project_text(project_texts)
    
    if not combined:
        return {
            "project_general_score": 0,
            "project_summary": "Evaluation failed: insufficient evidence (no project files parsed).",
            "project_fit": "N/A",
            "risk_notes": "No actual project files provided. Cannot verify claims."
        }

    prompt = f"""You are an expert technical evaluator. The candidate uploaded a project with the following description:
{description}

Here is the parsed content from the uploaded project files (code, reports, zip contents):
{combined}

Evaluate the project's technical complexity, quality, and how well it demonstrates actual capability.
CRITICAL: You MUST cite concrete signals directly from the parsed files (e.g. specific modules, tech stack, architectures, methods, diagrams). Do not just trust the description.

Return ONLY a JSON object with this exact structure:
{{
  "project_general_score": <int between 0 and 100>,
  "project_summary": "<string: concise summary of what was actually built based on the files>",
  "project_fit": "<string: how this project demonstrates skills relevant to typical industry needs>",
  "risk_notes": "<string: mention any thin evidence, missing files, or claim vs proof mismatches>"
}}
"""
    groq_key = os.environ.get("GROQ_API_KEY")
    gemini_key = os.environ.get("GEMINI_API_KEY")
    
    result = {
        "project_general_score": 0, 
        "project_summary": "Evaluation failed or APIs unavailable.",
        "project_fit": "N/A",
        "risk_notes": "N/A"
    }
    
    import json
    def try_parse(txt):
        try:
            start = txt.find("{")
            end = txt.rfind("}")
            if start != -1 and end != -1:
                return json.loads(txt[start:end+1])
        except Exception:
            pass
        return None

    if groq_key:
        try:
            from groq import Groq
            gc = Groq(api_key=groq_key, timeout=15.0)
            resp = gc.chat.completions.create(
                model="llama3-70b-8192",
                messages=[{"role": "user", "content": prompt}],
                temperature=0.3,
                max_tokens=500
            )
            parsed = try_parse(resp.choices[0].message.content)
            if parsed: return parsed
        except Exception as e:
            logger.error(f"Groq profile eval error: {e}")
            
    if gemini_key:
        try:
            import google.generativeai as genai
            genai.configure(api_key=gemini_key)
            model = genai.GenerativeModel("gemini-1.5-flash")
            resp = model.generate_content(prompt, request_options={"timeout": 15.0})
            parsed = try_parse(resp.text)
            if parsed: return parsed
        except Exception as e:
            logger.error(f"Gemini profile eval error: {e}")
            
    return result

def evaluate_repo_against_jd(project_summary: str, job_description: str) -> dict:
    prompt = f"""You are a senior technical recruiter evaluating if a candidate's portfolio project matches the job requirements.

Job Description:
{job_description}

Candidate's Project Summary:
{project_summary}

Compare the project summary against the job requirements. 
Return ONLY a JSON object with this exact structure:
{{
  "repo_match_score": <int between 0 and 100>,
  "repo_match_reasoning": "<concise 2-3 sentence explanation of why it fits or does not fit>"
}}
"""
    groq_key = os.environ.get("GROQ_API_KEY")
    gemini_key = os.environ.get("GEMINI_API_KEY")
    
    result = {"repo_match_score": 0, "repo_match_reasoning": "Evaluation failed or APIs unavailable."}
    
    import json
    def try_parse(txt):
        try:
            start = txt.find("{")
            end = txt.rfind("}")
            if start != -1 and end != -1:
                return json.loads(txt[start:end+1])
        except Exception:
            pass
        return None

    if groq_key:
        try:
            from groq import Groq
            gc = Groq(api_key=groq_key, timeout=15.0)
            resp = gc.chat.completions.create(
                model="llama3-70b-8192",
                messages=[{"role": "user", "content": prompt}],
                temperature=0.3,
                max_tokens=500
            )
            parsed = try_parse(resp.choices[0].message.content)
            if parsed: return parsed
        except Exception as e:
            logger.error(f"Groq repo match error: {e}")
            
    if gemini_key:
        try:
            import google.generativeai as genai
            genai.configure(api_key=gemini_key)
            model = genai.GenerativeModel("gemini-1.5-flash")
            resp = model.generate_content(prompt, request_options={"timeout": 15.0})
            parsed = try_parse(resp.text)
            if parsed: return parsed
        except Exception as e:
            logger.error(f"Gemini repo match error: {e}")
            
    return result
