"""Conservative notebook and dataset heuristics."""
import re
def analyse(files, evidence):
    findings=[]
    for e in evidence:
        if re.search(r'fit\s*before.*train_test_split|no test split',e.fact,re.I): findings.append({"fact":"Possible evaluation or leakage issue found in notebook evidence.","evidence_ids":[e.id]})
    return {"dataset":[],"metrics_vs_claims":[],"leakage_findings":findings}
