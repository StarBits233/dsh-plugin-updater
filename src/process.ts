/**
 * @dsh-external/dsh-plugin-updater — 进程诊断与孤儿后端检测模块。
 *
 * 针对 DSH 坑 6（桌面版退出/重启杀不掉孤儿后端，导致更新不生效）：
 * 1. 探查 3080 端口占用与当前 DSH Node 后端进程；
 * 2. 检查父子进程关系，精准识别孤儿进程（如父进程已退出或非当前桌面壳拉起）；
 * 3. 提供安全终止孤儿进程的能力。
 */
import { exec } from 'node:child_process'
import type { ProcessDiagnostic } from './types.js'

function execAsync(cmd: string, timeoutMs = 10000): Promise<{ stdout: string; stderr: string; code: number }> {
  return new Promise((resolve) => {
    exec(cmd, { timeout: timeoutMs, windowsHide: true }, (err, stdout, stderr) => {
      resolve({ stdout: String(stdout ?? ''), stderr: String(stderr ?? ''), code: err ? (err as any).code ?? 1 : 0 })
    })
  })
}

/** 诊断当前 DSH 进程状态。 */
export async function diagnoseDshProcess(port = 3080): Promise<ProcessDiagnostic> {
  const result: ProcessDiagnostic = {
    port,
    inUse: false,
    pid: null,
    name: null,
    commandLine: null,
    parentPid: null,
    parentName: null,
    isOrphan: false,
    isDesktop: false,
  }

  if (process.platform !== 'win32') {
    return result
  }

  try {
    // 1. 查 3080 端口占用 PID
    const portQuery = await execAsync(`powershell -NoProfile -Command "Get-NetTCPConnection -LocalPort ${port} -State Listen -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess"`)
    const listeningPid = parseInt(portQuery.stdout.trim(), 10)

    if (!isNaN(listeningPid) && listeningPid > 0) {
      result.inUse = true
      result.pid = listeningPid

      // 2. 查该进程详情及其父进程
      const procQuery = await execAsync(`powershell -NoProfile -Command "Get-CimInstance Win32_Process -Filter \\"ProcessId = ${listeningPid}\\" | Select-Object ProcessId, Name, ParentProcessId, CommandLine | ConvertTo-Json -Compress"`)
      if (procQuery.stdout.trim()) {
        try {
          const pInfo = JSON.parse(procQuery.stdout.trim())
          result.name = pInfo.Name
          result.commandLine = pInfo.CommandLine
          result.parentPid = pInfo.ParentProcessId

          // 查父进程名称
          if (pInfo.ParentProcessId) {
            const parentQuery = await execAsync(`powershell -NoProfile -Command "Get-CimInstance Win32_Process -Filter \\"ProcessId = ${pInfo.ParentProcessId}\\" | Select-Object -ExpandProperty Name"`)
            result.parentName = parentQuery.stdout.trim() || null
          }
        } catch { /* ignore */ }
      }
    }

    // 3. 查是否存在 dsh-desktop 桌面壳
    const desktopQuery = await execAsync('powershell -NoProfile -Command "Get-Process -Name dsh-desktop -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Id"')
    const desktopPids = desktopQuery.stdout.trim().split(/\r?\n/).map((s) => parseInt(s.trim(), 10)).filter((n) => !isNaN(n))
    result.isDesktop = desktopPids.length > 0

    // 4. 孤儿判定：
    // 若有后端在监听 3080，但父进程不存在 / 是 explorer.exe / 或存在桌面壳但父进程不是桌面壳
    if (result.inUse && result.pid) {
      if (!result.parentName || result.parentName.toLowerCase() === 'explorer.exe') {
        result.isOrphan = true
      } else if (result.isDesktop && result.parentName.toLowerCase() !== 'dsh-desktop.exe') {
        result.isOrphan = true
      }
    }
  } catch {
    // ignore
  }

  return result
}

/** 终止指定的进程及其子进程树。 */
export async function killProcessTree(pid: number): Promise<{ ok: boolean; output: string }> {
  if (!pid || pid <= 0) return { ok: false, output: '无效的 PID' }
  const res = await execAsync(`taskkill /PID ${pid} /T /F`)
  return {
    ok: res.code === 0,
    output: res.stdout || res.stderr || (res.code === 0 ? `已成功终止进程 ${pid}` : `终止失败`),
  }
}
