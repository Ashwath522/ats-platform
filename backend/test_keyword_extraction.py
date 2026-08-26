import os
import sys

sys.path.insert(0, os.path.abspath("."))

from app.services.keyword_extractor import extract_keywords, match_keywords

def test_keywords():
    jd = ["Python", "React", "AWS", "Machine Learning"]
    student_text = "I built a web app using Node.js and React.js. Deployed on Amazon Web Services. I also love ML."
    
    student_kws = extract_keywords(student_text)
    print("Extracted student keywords:", student_kws)
    
    match = match_keywords(student_kws, jd)
    print("Match result:", match)

if __name__ == "__main__":
    test_keywords()
