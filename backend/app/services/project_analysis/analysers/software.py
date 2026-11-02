"""Static software repository findings; uploaded code is never executed."""
import re
def analyse(files, evidence):
    findings=[]
    for e in evidence:
        if e.source_type=='file' and re.search(r'\b(TODO|FIXME)\b',e.fact,re.I): findings.append({"fact":"TODO/FIXME marker found in source evidence.","evidence_ids":[e.id]})
    return {"stack":[],"routes":[],"tests":[],"findings":findings}
