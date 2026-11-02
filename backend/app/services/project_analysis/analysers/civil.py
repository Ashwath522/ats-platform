def analyse(files, evidence):
    findings=[]
    for e in evidence:
        if any(x in e.fact.lower() for x in ('load','factor of safety','code compliance')): findings.append({"fact":"Structural or safety claim is unverified — not independently checked.","evidence_ids":[e.id]})
    return {"elements":[],"storeys":[],"findings":findings}
