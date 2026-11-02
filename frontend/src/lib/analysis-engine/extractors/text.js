export async function extract({ file, name, ext }) {
  const text=await file.text(); const lines=text.split(/\r?\n/); const imports=[...text.matchAll(/^\s*(?:import\s+[^;\n]+|from\s+[^\n]+|#include\s*[<"]([^>"]+)[>"])/gm)].map(x=>x[1]||x[0].trim()).slice(0,50)
  let fact=`${lines.length} lines`; const lang={'.py':'Python','.ino':'C/Arduino','.c':'C','.cpp':'C++','.h':'C/C++ header','.js':'JavaScript','.ts':'TypeScript','.json':'JSON','.ipynb':'Jupyter Notebook','.md':'Markdown','.csv':'CSV','.txt':'text'}[ext]||ext
  if(ext==='.ipynb'){ try { const j=JSON.parse(text); const cells=j.cells||[]; fact=`Jupyter Notebook with ${cells.filter(c=>c.cell_type==='code').length} code cells and ${cells.filter(c=>c.cell_type==='markdown').length} markdown cells`; } catch { return {evidence:[],warnings:['Notebook JSON could not be read']} } }
  const heading=(text.match(/^#\s+(.+)$/m)||[])[1]; if(heading) fact+=`; title: ${heading.slice(0,180)}`
  return {evidence:[{id:`client_${crypto.randomUUID()}`,source_type:'file',source_ref:name,locator:null,fact:`${name}: ${fact}${imports.length?`; imports/includes: ${imports.join(', ')}`:''}`,method:'parsed',confidence:'high',origin:'client'}],warnings:[]}
}
