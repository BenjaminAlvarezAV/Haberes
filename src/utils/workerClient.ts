import type { ParseProgress, ParseSercopeCsvOptions, ParseSercopeCsvResult } from './txtParser'
import { currentYYYYMM } from './period'

type WorkerSuccess = {
  type: 'success'
  result: ParseSercopeCsvResult
}

type WorkerProgress = {
  type: 'progress'
  progress: ParseProgress
}

type WorkerError = {
  type: 'error'
  message: string
}

type WorkerResponse = WorkerSuccess | WorkerProgress | WorkerError

export async function parseSercopeCsvInWorker(
  file: File,
  options: ParseSercopeCsvOptions = {},
): Promise<ParseSercopeCsvResult> {
  return await new Promise<ParseSercopeCsvResult>((resolve, reject) => {
    const worker = new Worker(new URL('../workers/sercopeCsvWorker.ts', import.meta.url), {
      type: 'module',
    })

    const cleanup = () => {
      worker.onmessage = null
      worker.onerror = null
      worker.terminate()
    }

    worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
      const data = event.data
      if (data?.type === 'progress') {
        options.onProgress?.(data.progress)
        return
      }
      if (data?.type === 'success') {
        resolve(data.result)
      } else {
        reject(new Error(data?.message ?? 'Error al procesar el CSV'))
      }
      cleanup()
    }

    worker.onerror = (event) => {
      reject(new Error(event.message || 'Error al procesar el CSV'))
      cleanup()
    }

    worker.postMessage({ file, maxYYYYMM: currentYYYYMM() })
  })
}
