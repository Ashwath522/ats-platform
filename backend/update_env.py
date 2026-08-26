import re
with open(".env", "r") as f:
    content = f.read()

content = re.sub(r'GEMINI_MODEL=.*', 'GEMINI_MODEL=gemini-3.6-flash', content)
if 'GROQ_MODEL=' not in content:
    content += '\nGROQ_MODEL=qwen/qwen3.8-27b\n'
else:
    content = re.sub(r'GROQ_MODEL=.*', 'GROQ_MODEL=qwen/qwen3.8-27b', content)

with open(".env", "w") as f:
    f.write(content)
