import { loadState, saveState, clearState } from './storage.js'
export function capabilities(){ return {worker:typeof Worker!=='undefined',indexedDB:typeof indexedDB!=='undefined',subtle:!!globalThis.crypto?.subtle,webgpu:typeof navigator!=='undefined'&&!!navigator.gpu} }
export function startAnalysis({projectId,jobId,files,onProgress}) { return new Promise(async (resolve,reject)=>{ if(!capabilities().worker){onProgress?.({type:'error',message:'Your browser cannot run the file reader — only basic checks will be done'}); resolve({evidence:[],warnings:['Browser worker unavailable']}); return} const worker=new Worker(new URL('./worker.js',import.meta.url),{type:'module'}); const state=await loadState(jobId)||{done:[]}; const pending=files.filter(f=>!state.done.includes(f.id)); const evidence=[]; worker.onmessage=async e=>{ onProgress?.(e.data); if(e.data.type==='evidence'){evidence.push(...e.data.evidence); await saveState(jobId,{done:[...state.done,e.data.fileId],evidence})} if(e.data.type==='done'){await clearState(jobId);worker.terminate();resolve({evidence,warnings:[]})} if(e.data.type==='error'){worker.terminate();reject(Error(e.data.message))} }; worker.postMessage({type:'start',projectId,jobId,files:pending}) }) }
export async function resumeAnalysis(jobId){ return loadState(jobId) }
export function cancelAnalysis(){ /* Worker cancellation is intentionally cooperative; page unload leaves resumable state. */ }

/** Upload one file's evidence, retrying transient failures and returning false when resumable work is needed. */
export async function uploadEvidenceWithRetry({ upload, payload, attempts = 3, delay = 250 }) {
  for (let n = 0; n < attempts; n += 1) {
    try { return await upload(payload) } catch (error) {
      if (n === attempts - 1) return false
      await new Promise((resolve) => setTimeout(resolve, delay * (n + 1)))
    }
  }
  return false
}

export function clientStatusPayload(percentage, currentFile) { return { percentage: Math.max(0, Math.min(100, Math.round(percentage))), current_file: currentFile || null } }
