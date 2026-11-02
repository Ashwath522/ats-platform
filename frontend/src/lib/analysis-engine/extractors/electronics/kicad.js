function ev(fact, source, locator=null){return {id:`client_${crypto.randomUUID()}`,source_type:'file',source_ref:source,locator,fact,method:'parsed',confidence:'high',origin:'client'}}
export async function extract({file,name,ext}){ const t=await file.text(); const out=[]; const warnings=[]
 if(ext==='.kicad_sch'){ for(const m of t.matchAll(/\(property\s+"Reference"\s+"([^"]+)"[\s\S]*?\(property\s+"Value"\s+"([^"]*)"/g)){out.push(ev(`${m[1]} has value '${m[2]}'`,name,{file:name,reference:m[1]}))} for(const m of t.matchAll(/\((?:global_label|label)\s+"([^"]+)"/g))out.push(ev(`Label '${m[1]}' is present`,name,{file:name,label:m[1]})); warnings.push('Connections not derived — export a netlist (.net) for exact wiring.') }
 if(ext==='.net'){ for(const m of t.matchAll(/<net\s+code="[^"]+"\s+name="([^"]+)"[\s\S]*?<node\s+ref="([^"]+)"\s+pin="([^"]+)"/g)){out.push(ev(`Net '${m[1]}' includes ${m[2]} pin ${m[3]}`,name,{file:name,net:m[1]}))} }
 if(ext==='.kicad_pcb'){const size=t.match(/\(paper\s+"([^"]+)"/); out.push(ev(`${name}: PCB file with declared layer data`,name)); if(size)out.push(ev(`Board paper size is ${size[1]}`,name))}
 return {evidence:out,warnings} }
