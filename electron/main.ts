import { app, BrowserWindow, ipcMain, dialog, shell } from 'electron'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { exec, spawn } from 'node:child_process'
import { readFile, writeFile } from 'node:fs/promises'
import { existsSync, readFileSync, writeFileSync, createReadStream, mkdirSync } from 'node:fs'
import { createInterface } from 'node:readline'
// @ts-ignore
import { Config, Assignment } from './types'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

process.env.APP_ROOT = path.join(__dirname, '..')

export const VITE_DEV_SERVER_URL = process.env['VITE_DEV_SERVER_URL']
export const MAIN_DIST = path.join(process.env.APP_ROOT, 'dist-electron')
export const RENDERER_DIST = path.join(process.env.APP_ROOT, 'dist')

process.env.VITE_PUBLIC = VITE_DEV_SERVER_URL ? path.join(process.env.APP_ROOT, 'public') : RENDERER_DIST

let win: BrowserWindow | null

// App Settings (Persistent)
const SETTINGS_FILE = path.join(app.getPath('userData'), 'app-settings.json')

interface AppSettings {
  configPath: string;
  assignmentsPath: string;
  cronDbPath: string;
}

// Global path variables
let currentSettings: AppSettings = {
  configPath: '',
  assignmentsPath: '',
  cronDbPath: ''
}
let configCache: any = null

// Initialization gate: resolved when initSettings + ensurePhpenv complete
let resolveInitReady: () => void
const initReady = new Promise<void>(r => { resolveInitReady = r })

function createWindow() {
  win = new BrowserWindow({
    icon: path.join(process.env.VITE_PUBLIC ?? '', 'electron-vite.svg'),
    width: 1200,
    height: 800,
    webPreferences: {
      preload: path.join(__dirname, 'preload.mjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
    title: 'mnglocaldev'
  })

  win.setMenuBarVisibility(false)

  win.webContents.on('did-finish-load', () => {
    win?.webContents.send('main-process-message', (new Date).toLocaleString())
  })

  // Open DevTools in dev mode
  if (VITE_DEV_SERVER_URL) {
    win.loadURL(VITE_DEV_SERVER_URL)
    win.webContents.openDevTools()
  } else {
    // In production, we sometimes want logs too if things are failing
    // win.webContents.openDevTools() 
    win.loadFile(path.join(RENDERER_DIST, 'index.html'))
  }
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
    win = null
  }
})

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow()
  }
})

// Initialize Settings
async function initSettings() {
  console.log('Using settings file:', SETTINGS_FILE)

  // Load or trigger setup if files are missing
  let needsSetup = !existsSync(SETTINGS_FILE)
  if (!needsSetup) {
    try {
      const data = readFileSync(SETTINGS_FILE, 'utf-8')
      currentSettings = JSON.parse(data)
      // Check if configPath actually exists
      if (!currentSettings.configPath || !existsSync(currentSettings.configPath)) {
        console.log('Detected invalid or missing config path. Triggering setup.')
        needsSetup = true
      }
    } catch (e) {
      console.log('Failed to read settings file. Triggering setup.')
      needsSetup = true
    }
  }

  if (needsSetup) {
    console.log('Setup needed. Starting setup flow.')

    const defaultBase = 'C:\\Projects\\yoProductFlow'

    // Show welcome dialog
    const choice = await dialog.showMessageBox({
      type: 'info',
      title: '初期セットアップ',
      message: 'mnglocaldev へようこそ！\n\n設定とデータを保存するディレクトリを選択してください。',
      detail: `デフォルト: ${defaultBase}`,
      buttons: ['デフォルトを使用', '別のフォルダを選択', 'キャンセル'],
      defaultId: 0
    })

    if (choice.response === 2) {
      console.log('User canceled setup. Quitting.')
      app.quit()
      return
    }

    let storageBase = defaultBase
    if (choice.response === 1) {
      const result = await dialog.showOpenDialog({
        properties: ['openDirectory', 'createDirectory'],
        title: '保存先のディレクトリを選択'
      })
      if (result.canceled || result.filePaths.length === 0) {
        console.log('User canceled directory selection. Quitting.')
        app.quit()
        return
      }
      storageBase = result.filePaths[0]
    }

    console.log(`Setting up directories in: ${storageBase}`)
    if (win) win.webContents.send('setup:status', 'ディレクトリの作成中...')
    const containerDir = path.join(storageBase, 'container')
    const phpManagerDir = path.join(storageBase, 'phpmanager')
    const dockerEnvDir = path.join(storageBase, 'phpenv_nginx')
    const cronDir = path.join(storageBase, 'cron')

    try {
      if (!existsSync(storageBase)) mkdirSync(storageBase, { recursive: true })
      if (!existsSync(containerDir)) mkdirSync(containerDir)
      if (!existsSync(phpManagerDir)) mkdirSync(phpManagerDir)
      if (!existsSync(dockerEnvDir)) mkdirSync(dockerEnvDir)
      if (!existsSync(cronDir)) mkdirSync(cronDir)

      const configPath = path.join(containerDir, 'config.json')
      const assignmentsPath = path.join(phpManagerDir, 'assignments.json')
      const cronDbPath = path.join(cronDir, 'cron_jobs.db')

      // Create placeholder config if not exists
      if (!existsSync(configPath)) {
        const defaultPhpenvRoot = storageBase.replace(/^([a-zA-Z]):/, (_, d) => `/mnt/${d.toLowerCase()}`).replace(/\\/g, '/') + '/phpenv'
        const defaultConfig = {
          profile: "default",
          project_root: dockerEnvDir,
          wsl_distro: "OracleLinux_9_4",
          compose_file: path.join(dockerEnvDir, "docker-compose.yml"),
          phpenv_root: defaultPhpenvRoot,
          web_port: 8082
        }
        writeFileSync(configPath, JSON.stringify(defaultConfig, null, 2), 'utf-8')
        console.log('Created default config.json')
      }

      // Create placeholder assignments if not exists
      if (!existsSync(assignmentsPath)) {
        writeFileSync(assignmentsPath, "[]", 'utf-8')
        console.log('Created empty assignments.json')
      }

      currentSettings = {
        configPath,
        assignmentsPath,
        cronDbPath
      }

      writeFileSync(SETTINGS_FILE, JSON.stringify(currentSettings, null, 2), 'utf-8')
      console.log('Saved app-settings.json')
    } catch (e: any) {
      console.error('Setup failed during file creation:', e)
      await dialog.showErrorBox('Setup Error', `Failed to initialize directory: ${e.message}`)
      app.quit()
      return
    }
  } else {
    console.log('Already configured. Ensuring directories exist.')
    try {
      const setupDir = path.dirname(path.dirname(currentSettings.configPath))
      const containerDir = path.join(setupDir, 'container')
      const phpManagerDir = path.join(setupDir, 'phpmanager')
      const dockerEnvDir = path.join(setupDir, 'phpenv_nginx')
      const cronDir = path.join(setupDir, 'cron')

      if (!existsSync(setupDir)) mkdirSync(setupDir, { recursive: true })
      if (!existsSync(containerDir)) mkdirSync(containerDir)
      if (!existsSync(phpManagerDir)) mkdirSync(phpManagerDir)
      if (!existsSync(dockerEnvDir)) mkdirSync(dockerEnvDir)
      if (!existsSync(cronDir)) mkdirSync(cronDir)

      // Migration: If cronDbPath is missing in existing settings, initialize it
      if (!currentSettings.cronDbPath) {
        currentSettings.cronDbPath = path.join(cronDir, 'cron_jobs.db')
        writeFileSync(SETTINGS_FILE, JSON.stringify(currentSettings, null, 2), 'utf-8')
        console.log('Migrated settings to include cronDbPath')
      }
    } catch (e) {
      console.error('Failed to ensure directories:', e)
    }
  }

  // Ensure files exist in the configured paths
  try {
    if (!existsSync(currentSettings.configPath)) {
      const setupDir = path.dirname(path.dirname(currentSettings.configPath))
      const dockerEnvDir = path.join(setupDir, 'phpenv_nginx')
      const defaultPhpenvRoot = setupDir.replace(/^([a-zA-Z]):/, (_, d) => `/mnt/${d.toLowerCase()}`).replace(/\\/g, '/') + '/phpenv'
      const defaultConfig = {
        profile: "default",
        project_root: dockerEnvDir,
        wsl_distro: "OracleLinux_9_4",
        compose_file: path.join(dockerEnvDir, "docker-compose.yml"),
        phpenv_root: defaultPhpenvRoot,
        web_port: 8082
      }
      if (!existsSync(path.dirname(currentSettings.configPath))) {
        mkdirSync(path.dirname(currentSettings.configPath), { recursive: true })
      }
      writeFileSync(currentSettings.configPath, JSON.stringify(defaultConfig, null, 2), 'utf-8')
      console.log('Re-created missing config.json')
    }
    if (!existsSync(currentSettings.assignmentsPath)) {
      if (!existsSync(path.dirname(currentSettings.assignmentsPath))) {
        mkdirSync(path.dirname(currentSettings.assignmentsPath), { recursive: true })
      }
      writeFileSync(currentSettings.assignmentsPath, "[]", 'utf-8')
      console.log('Re-created missing assignments.json')
    }
  } catch (e) {
    console.error('Failed to ensure config/assignments files:', e)
  }

  // Docker Check: Runs on every startup to ensure the user is informed if Docker is missing
  console.log('Checking for Docker installation...')
  if (win) win.webContents.send('setup:status', 'Docker の状態を確認中...')

  let isDockerInstalled = await new Promise<boolean>(r => exec('docker -v', e => r(!e)))

  if (!isDockerInstalled && process.platform === 'win32') {
    console.log('Docker not found in PATH. Checking common installation paths...')
    const commonPaths = [
      'C:\\Program Files\\Docker\\Docker\\resources\\bin',
      'C:\\Program Files\\Docker\\Docker\\resources'
    ]

    for (const p of commonPaths) {
      if (existsSync(path.join(p, 'docker.exe'))) {
        console.log(`Found Docker at ${p}. Adding to PATH.`)
        process.env.PATH = `${p}${path.delimiter}${process.env.PATH}`
        // Re-check
        isDockerInstalled = await new Promise<boolean>(r => exec('docker -v', e => r(!e)))
        if (isDockerInstalled) break
      }
    }
  }

  if (!isDockerInstalled) {
    console.log('Docker not found. Showing warning dialog.')
    await dialog.showMessageBox({
      type: 'warning',
      title: 'Docker Desktop Required',
      message: 'Docker Desktop が見つかりませんでした。',
      detail: 'このアプリケーションを正常に動作させるには Docker Desktop のインストールが必要です。',
      buttons: ['ダウンロードページを開く', '後で (アプリは制限された状態で起動します)'],
      defaultId: 0
    }).then(result => {
      if (result.response === 0) {
        shell.openExternal('https://www.docker.com/products/docker-desktop/')
      }
    })
  } else {
    // Docker is installed, perform automatic setup if there are no containers yet
    if (win) win.webContents.send('setup:status', '既存コンテナの確認中...')
    const hasContainers = await new Promise<boolean>(r => {
      exec('docker ps -a --format "{{.Names}}"', (err, stdout) => {
        r(!err && (stdout.includes('myapp_nginx') || stdout.includes('myapp_db')))
      })
    })

    if (!hasContainers) {
      console.log('No containers found. Performing automatic setup...')
      if (win) win.webContents.send('setup:status', '環境の構築中 (初回起動)...')
      try {
        const cfg = await ensureConfig()
        const baseDir = cfg.project_root
        const composeFile = path.join(baseDir, 'docker-compose.yml')
        const confDir = path.join(baseDir, 'conf.d')
        // Fresh setup = empty assignments
        await performSync([], baseDir, composeFile, confDir)
        console.log('Automatic container setup complete.')
      } catch (e) {
        console.error('Automatic container setup failed', e)
      }
    } else {
      console.log('Containers already exist. Skipping automatic setup.')
    }
  }

  if (win) win.webContents.send('setup:status', null)
  try {
    await ensureCronDb()
    await writeCronScripts()
  } catch (e) {
    console.error('Cron setup failed (non-critical, continuing):', e)
  }
}

async function ensureCronDb() {
  const { wsl_distro } = await ensureConfig()
  const dbPath = currentSettings.cronDbPath.replace(/^([a-zA-Z]):/, (_, d) => `/mnt/${d.toLowerCase()}`).replace(/\\/g, '/')

  console.log('Ensuring Cron DB at:', dbPath)
  const tables = [
    "CREATE TABLE IF NOT EXISTS jobs (id INTEGER PRIMARY KEY AUTOINCREMENT, command TEXT NOT NULL, schedule TEXT NOT NULL, description TEXT)",
    "CREATE TABLE IF NOT EXISTS environment_variables (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL UNIQUE, value TEXT, description TEXT)",
    "CREATE TABLE IF NOT EXISTS settings (name TEXT PRIMARY KEY, value TEXT)",
    "CREATE TABLE IF NOT EXISTS wrappers (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL UNIQUE, value TEXT, description TEXT)",
    "CREATE TABLE IF NOT EXISTS job_status (job_id INTEGER PRIMARY KEY, start_time DATETIME, end_time DATETIME, exit_code INTEGER, FOREIGN KEY(job_id) REFERENCES jobs(id) ON DELETE CASCADE)"
  ]

  for (const sql of tables) {
    await runWsl(wsl_distro, `sqlite3 ${dbPath} "${sql}"`)
  }
}

async function generateCrontabContent() {
  const jobs = await runCronQuery("SELECT id, schedule, command FROM jobs ORDER BY id ASC")
  const envVars = await runCronQuery("SELECT name, value FROM environment_variables ORDER BY name ASC")
  const wrappers = await runCronQuery("SELECT name, value FROM wrappers")
  const settings = await runCronQuery("SELECT value FROM settings WHERE name = 'cron_user'")
  const cronUser = settings[0]?.value || 'root'

  let lines = [
    "# Generated by mnglocaldev",
    "SHELL=/bin/bash",
    "PATH=/sbin:/bin:/usr/sbin:/usr/bin"
  ]

  for (const env of envVars) {
    lines.push(`${env.name}="${env.value}"`)
  }

  const cronDirWsl = path.dirname(currentSettings.cronDbPath).replace(/^([a-zA-Z]):/, (_, d) => `/mnt/${d.toLowerCase()}`).replace(/\\/g, '/')
  const runnerScript = `${cronDirWsl}/cron_runner.sh`

  for (const job of jobs) {
    let finalCmd = job.command
    for (const wrap of wrappers) {
      finalCmd = finalCmd.replace(new RegExp(`\\$\\{${wrap.name}\\}`, 'g'), wrap.value)
    }

    if (finalCmd.trim().startsWith('#')) {
      lines.push(`${job.schedule} ${cronUser} ${finalCmd}`)
    } else {
      // Escape command for bash runner
      const escapedCmd = finalCmd.replace(/'/g, "'\\''")
      lines.push(`${job.schedule} ${cronUser} /bin/bash ${runnerScript} ${job.id} '${escapedCmd}'`)
    }
  }

  return lines.join('\n') + '\n'
}

async function writeCronScripts() {
  const cronDir = path.dirname(currentSettings.cronDbPath)
  await ensureConfig()

  const runnerPath = path.join(cronDir, 'cron_runner.sh')
  const deployPath = path.join(cronDir, 'deploy_cron.sh')

  const dbPathWsl = currentSettings.cronDbPath.replace(/^([a-zA-Z]):/, (_, d) => `/mnt/${d.toLowerCase()}`).replace(/\\/g, '/')

  const runnerContent = `#!/bin/bash
# Cron Runner Script (Bash)
JOB_ID="$1"
COMMAND="$2"
DB_FILE="${dbPathWsl}"
SQLITE_BIN=$(command -v sqlite3 || echo "/usr/bin/sqlite3")

if [ -z "$JOB_ID" ] || [ -z "$COMMAND" ]; then
    echo "Usage: $0 <job_id> <command>"
    exit 1
fi

# Update start time (with 5s timeout for locks)
START_TIME=$(date '+%Y-%m-%d %H:%M:%S')
"$SQLITE_BIN" -cmd ".timeout 5000" "$DB_FILE" "INSERT INTO job_status (job_id, start_time, end_time, exit_code) VALUES ($JOB_ID, '$START_TIME', NULL, NULL) ON CONFLICT(job_id) DO UPDATE SET start_time=excluded.start_time, end_time=NULL, exit_code=NULL"

# Execute command in a subshell to prevent it from terminating the runner prematurely
bash -c "$COMMAND"
EXIT_CODE=$?

# Update end time
END_TIME=$(date '+%Y-%m-%d %H:%M:%S')
"$SQLITE_BIN" -cmd ".timeout 5000" "$DB_FILE" "UPDATE job_status SET end_time = '$END_TIME', exit_code = $EXIT_CODE WHERE job_id = $JOB_ID"
exit $EXIT_CODE
`

  const deployContent = `#!/bin/bash
set -euo pipefail
SCRIPT_DIR=$(dirname "$(readlink -f "\${BASH_SOURCE[0]}")")
SOURCE_FILE="\${SCRIPT_DIR}/crontab.txt"
DEST_FILE="/etc/cron.d/mnglocaldev_cron_jobs"

if [ ! -f "\${SOURCE_FILE}" ]; then echo "Error: crontab.txt not found."; exit 1; fi
mv "\${SOURCE_FILE}" "\${DEST_FILE}"
chmod 644 "\${DEST_FILE}" 
chown root:root "\${DEST_FILE}"
if command -v restorecon >/dev/null 2>&1; then restorecon -v "\${DEST_FILE}"; fi
systemctl daemon-reload || true
echo "Success: Updated \${DEST_FILE}"`

  writeFileSync(runnerPath, runnerContent.replace(/\r\n/g, '\n'))
  writeFileSync(deployPath, deployContent.replace(/\r\n/g, '\n'))

  const crontabContent = await generateCrontabContent()
  writeFileSync(path.join(cronDir, 'crontab.txt'), crontabContent)
}

async function runCronQuery(sql: string, params: any[] = []): Promise<any> {
  const { wsl_distro } = await ensureConfig()
  const dbPath = currentSettings.cronDbPath.replace(/^([a-zA-Z]):/, (_, d) => `/mnt/${d.toLowerCase()}`).replace(/\\/g, '/')

  // Construct SQL with parameters replaced
  let finalSql = sql
  if (params && params.length > 0) {
    let paramIdx = 0
    finalSql = sql.replace(/\?/g, () => {
      const val = params[paramIdx++]
      if (typeof val === 'string') return `'${val.replace(/'/g, "''")}'`
      if (val === null) return 'NULL'
      return val
    })
  }

  try {
    const output = await runWsl(wsl_distro, `sqlite3 -json ${dbPath} "${finalSql}"`)
    if (!output.trim()) return []
    return JSON.parse(output)
  } catch (e: any) {
    if (sql.trim().toUpperCase().startsWith('SELECT')) {
      return []
    }
    return { success: true }
  }
}



app.whenReady().then(async () => {
  createWindow()
  // Wait a bit for window to be ready
  await new Promise(r => setTimeout(r, 1000))
  try {
    await initSettings()
    await ensurePhpenv()
  } catch (e) {
    console.error('Initialization failed:', e)
  } finally {
    resolveInitReady()
  }
})

// --- Logic Helpers ---

async function ensurePhpenv() {
  try {
    const { wsl_distro, phpenv_root } = await ensureConfig()
    console.log('Checking phpenv installation at:', phpenv_root)

    // Check for git
    try {
      await runWsl(wsl_distro, 'git --version')
    } catch (e) {
      console.log('git not found. Installing...')
      if (win) win.webContents.send('setup:status', 'git をインストール中...')
      // Install git (Oracle Linux uses dnf)
      try {
        await runWsl(wsl_distro, 'dnf install -y git', { asRoot: true })
      } catch (installErr) {
        console.error('Failed to install git:', installErr)
        throw new Error('git のインストールに失敗しました。WSL環境を確認してください。')
      }
    }

    // Check if phpenv exists
    try {
      await runWsl(wsl_distro, `test -f "${phpenv_root}/bin/phpenv"`)
      console.log('phpenv is already installed.')
      return
    } catch (e) {
      console.log('phpenv not found. Installing...')
    }

    if (win) win.webContents.send('setup:status', 'phpenv をインストール中...')

    // Install phpenv
    await runWsl(wsl_distro, `git clone https://github.com/phpenv/phpenv.git "${phpenv_root}"`)

    // Install php-build plugin (needed for 'install' command)
    await runWsl(wsl_distro, `git clone https://github.com/php-build/php-build.git "${phpenv_root}/plugins/php-build"`)

    console.log('phpenv installation complete.')
    if (win) win.webContents.send('setup:status', null)

  } catch (e) {
    console.error('Failed to ensure phpenv:', e)
    if (win) win.webContents.send('setup:status', 'phpenv のインストールに失敗しました')
  }
}


async function runWsl(distro: string, cmd: string, options: { asRoot?: boolean; timeout?: number } | boolean = false): Promise<string> {
  const asRoot = typeof options === 'boolean' ? options : options?.asRoot
  const timeout = typeof options === 'object' ? options?.timeout : undefined

  return new Promise((resolve, reject) => {
    // Debug logging
    console.log(`[WSL Request] Distro: ${distro}, Cmd: ${cmd}, Root: ${asRoot}, Timeout: ${timeout}`)

    // We will use standard execution but capture stderr explicitly.
    const escapedCmd = cmd.replace(/"/g, '\\"')
    const userFlag = asRoot ? '-u root' : ''
    // Note: wsl -u root works without password 
    const fullCmd = `wsl -d ${distro} ${userFlag} -- bash -c "${escapedCmd}"`

    // Add forcing UTF-8 encoding for child_process
    exec(fullCmd, { encoding: 'utf8', timeout }, (error, stdout, stderr) => {
      if (error) {
        console.error(`[WSL Error] Command: ${fullCmd}`)
        console.error(`[WSL Error] Stderr: ${stderr}`)
        console.error(`[WSL Error] Stdout: ${stdout}`)
        if (error.signal === 'SIGTERM' && timeout) {
          reject('WSL command timed out')
        } else {
          reject(stderr || error.message)
        }
      } else {
        console.log(`[WSL Success] Output length: ${stdout.length}`)
        resolve(stdout.trim())
      }
    })
  })
}

// Ensure config is loaded or reload if needed
async function ensureConfig() {
  if (configCache) return configCache
  if (!currentSettings.configPath) throw new Error('Config path is not set')

  try {
    let data = await readFile(currentSettings.configPath, 'utf-8')
    // Fix BOM issue if present
    if (data.charCodeAt(0) === 0xFEFF) {
      data = data.slice(1)
    }
    configCache = JSON.parse(data)
    return configCache
  } catch (e: any) {
    console.error(`Failed to read config at ${currentSettings.configPath}`, e)
    throw new Error(`Failed to read config from ${currentSettings.configPath}: ${e.message}`)
  }
}


// IPC Handlers

// Get current paths settings
ipcMain.handle('app:getPaths', async () => {
  await initReady
  return currentSettings
})

// Update paths settings
ipcMain.handle('app:updatePaths', (_, newSettings: AppSettings) => {
  currentSettings = newSettings
  try {
    writeFileSync(SETTINGS_FILE, JSON.stringify(currentSettings, null, 2), 'utf-8')
    configCache = null // clear cache to reload from new path
    return true
  } catch (e) {
    return false
  }
})

// File Dialog
// File Dialog
ipcMain.handle('dialog:openFile', async () => {
  // Legacy support or specific file opening
  const result = await dialog.showOpenDialog(win!, {
    properties: ['openFile']
  })
  if (result.canceled || result.filePaths.length === 0) return null
  return result.filePaths[0]
})

ipcMain.handle('dialog:openDirectory', async () => {
  const result = await dialog.showOpenDialog(win!, {
    properties: ['openDirectory']
  })
  if (result.canceled || result.filePaths.length === 0) return null
  return result.filePaths[0]
})


ipcMain.handle('app:openExternal', (_, url) => {
  if (url) shell.openExternal(url)
})

ipcMain.handle('app:getConfig', async () => {
  await initReady
  try {
    const cfg = await ensureConfig()
    if (!cfg.wsl_distro || !cfg.phpenv_root) {
      throw new Error('Invalid Config: Missing wsl_distro or phpenv_root')
    }
    return cfg
  } catch (e: any) {
    console.error('App GetConfig Error:', e)
    throw e
  }
})

ipcMain.handle('app:getAssignments', async () => {
  await initReady
  if (!currentSettings.assignmentsPath) return []
  try {
    let data = await readFile(currentSettings.assignmentsPath, 'utf-8')
    // Fix BOM issue if present
    if (data.charCodeAt(0) === 0xFEFF) {
      data = data.slice(1)
    }
    return JSON.parse(data)
  } catch (e: any) {
    console.error(`Failed to read assignments at ${currentSettings.assignmentsPath}`, e)
    return []
  }
})

ipcMain.handle('app:saveAssignments', async (_, assignments: any[]) => {
  if (!currentSettings.assignmentsPath) return false

  try {
    const { wsl_distro } = await ensureConfig()

    // 1. Get current assignments to detect removals
    let oldAssignments: any[] = []
    try {
      const data = await readFile(currentSettings.assignmentsPath, 'utf-8')
      oldAssignments = JSON.parse(data.charCodeAt(0) === 0xFEFF ? data.slice(1) : data)
    } catch (e) { }

    // 2. Identify removed assignments and delete their .php-version files
    for (const oldA of oldAssignments) {
      const stillExists = assignments.find(newA => newA.win_path === oldA.win_path)
      if (!stillExists) {
        const wslPath = oldA.wsl_path || oldA.win_path.replace(/^([a-zA-Z]):/, (_: any, d: string) => `/mnt/${d.toLowerCase()}`).replace(/\\/g, '/')
        try {
          await runWsl(wsl_distro, `rm -f '${wslPath}/.php-version'`)
          console.log(`Cleaned up .php-version for removed assignment: ${wslPath}`)
        } catch (e) {
          console.warn(`Failed to cleanup .php-version for ${wslPath}`, e)
        }
      }
    }

    // 3. Update/Create .php-version for all current assignments
    for (const a of assignments) {
      if (!a.win_path || !a.php_version) continue
      const wslPath = a.wsl_path || a.win_path.replace(/^([a-zA-Z]):/, (_: any, d: string) => `/mnt/${d.toLowerCase()}`).replace(/\\/g, '/')
      try {
        await runWsl(wsl_distro, `mkdir -p '${wslPath}' && echo -n '${a.php_version}' > '${wslPath}/.php-version'`)
        console.log(`Updated .php-version for ${wslPath} to ${a.php_version}`)
      } catch (e) {
        console.error(`Failed to update .php-version for ${wslPath}`, e)
      }
    }

    // 4. Save to JSON and generate Nginx config as before
    await writeFile(currentSettings.assignmentsPath, JSON.stringify(assignments, null, 4), 'utf-8')

    const { project_root } = await ensureConfig()
    const confDir = path.join(project_root, 'nginx-projects')

    let confContent = ''
    for (const a of assignments) {
      if (!a.url_path || !a.doc_root || !a.port) continue;

      let pathPart = '/' + path.basename(a.win_path)
      if (a.url_path.includes('/')) {
        const idx = a.url_path.indexOf('/')
        pathPart = a.url_path.substring(idx)
      } else if (a.url_path !== 'localhost') {
        pathPart = '/' + a.url_path
      }

      pathPart = pathPart.replace(/\/+$/, '')
      if (!pathPart.startsWith('/')) pathPart = '/' + pathPart

      const label = pathPart.substring(1).replace(/[^a-zA-Z0-9]/g, '_')

      confContent += `
    location ${pathPart} {
        alias ${a.doc_root};
        index index.php index.html;
        try_files $uri $uri/ @${label};

        location ~ \\.php$ {
            if (!-f $request_filename) { return 404; }
            fastcgi_split_path_info ^(.+\\.php)(/.+)$;
            fastcgi_pass host.docker.internal:${a.port};
            fastcgi_index index.php;
            include fastcgi_params;
            fastcgi_param SCRIPT_FILENAME $request_filename;
            fastcgi_param PATH_INFO $fastcgi_path_info;
            fastcgi_read_timeout 300;
        }
    }

    location @${label} {
        rewrite ${pathPart}/(.*)$ ${pathPart}/index.php?/$1 last;
    }
`
    }

    if (!existsSync(confDir)) {
      mkdirSync(confDir, { recursive: true })
    }

    const confPath = path.join(confDir, 'assignments.conf')
    await writeFile(confPath, confContent, 'utf-8')
    console.log(`Generated Nginx config at ${confPath}`)

    const { compose_file } = await ensureConfig()
    exec(`docker compose -f "${compose_file}" ps --format "{{.Name}}"`, { cwd: project_root }, (err, stdout) => {
      if (!err) {
        const nginxContainer = stdout.split('\n').find(l => l.includes('nginx'))
        if (nginxContainer) {
          const containerName = nginxContainer.trim()
          exec(`docker exec ${containerName} nginx -s reload`, (err2) => {
            if (err2) console.error('Failed to reload nginx', err2)
            else console.log('Nginx reloaded')
          })
        }
      }
    })

  } catch (e: any) {
    console.error('Failed to save assignments or sync .php-version', e)
    return false
  }

  return true
})

ipcMain.handle('phpenv:listVersions', async () => {
  try {
    const { wsl_distro, phpenv_root } = await ensureConfig()
    console.log(`Listing versions from ${phpenv_root}/versions/ on ${wsl_distro}`)

    // Ensure versions directory exists
    await runWsl(wsl_distro, `mkdir -p "${phpenv_root}/versions"`)

    const output = await runWsl(wsl_distro, `ls -1v ${phpenv_root}/versions/`)

    const versions = output.split('\n')
      .map(v => v.trim())
      .filter(v => v && /^\d/.test(v))

    console.log(`Found versions:`, versions)
    return versions
  } catch (e: any) {
    console.error('List versions failed', e)
    // If the directory is empty, ls may fail - return empty array
    return []
  }
})

ipcMain.handle('phpenv:listInstallable', async () => {
  const { wsl_distro, phpenv_root } = await ensureConfig()
  const cmd = `export PHPENV_ROOT='${phpenv_root}'; ${phpenv_root}/bin/phpenv install --list`
  try {
    // Add a 30s timeout to prevent hanging on git operations
    const output = await runWsl(wsl_distro, cmd, { timeout: 30000 })
    return output.split('\n').map(v => v.trim()).filter(v => /^\d+\.\d+\.\d+$/.test(v)).reverse()
  } catch (e: any) {
    console.error('List installable failed:', e)
    return []
  }
})

// Store active install process
let currentInstallProcess: any = null

ipcMain.handle('phpenv:install', async (event, version) => {
  try {
    const { wsl_distro, phpenv_root } = await ensureConfig()
    const sender = event.sender

    // Prevent concurrent installs managed by this app
    if (currentInstallProcess) {
      // Allow re-entry if process is gone but variable stuck? No, just throw.
      throw new Error('Another installation is already in progress.')
    }

    // We use spawn to stream output
    // Note: phpenv install might spawn sub-processes. Killing the parent wsl process might not kill everything.
    const cmd = `export PHPENV_ROOT='${phpenv_root}'; source ~/.bashrc 2>/dev/null; ${phpenv_root}/bin/phpenv install ${version}`
    const wslArgs = ['-d', wsl_distro, '--', 'bash', '-c', cmd]

    console.log(`[Install] Spawning: wsl ${wslArgs.join(' ')}`)

    const { spawn } = await import('node:child_process')
    const child = spawn('wsl', wslArgs)
    currentInstallProcess = child

    child.stdout.on('data', (data) => {
      const line = data.toString()
      console.log(`[Install STDOUT] ${line}`)
      sender.send('install:progress', line)
    })

    child.stderr.on('data', (data) => {
      const line = data.toString()
      console.error(`[Install STDERR] ${line}`)
      sender.send('install:progress', line)
    })

    return new Promise((resolve, reject) => {
      child.on('close', async (code) => {
        // Cleanup on failure or cancel
        if (code !== 0 || child.killed) {
          try {
            // Ensure we cleanup the version dir if it failed
            // This is critical if cancelled.
            const rmCmd = `rm -rf ${phpenv_root}/versions/${version}`
            await runWsl(wsl_distro, rmCmd)
          } catch (e) { }
        }

        if (code === 0 && !child.killed) {
          resolve(true)
        } else {
          if (child.killed) {
            reject(new Error('Installation cancelled.'))
          } else {
            reject(new Error(`Install failed with code ${code}`))
          }
        }

        currentInstallProcess = null
      })

      child.on('error', (err) => {
        currentInstallProcess = null
        reject(err)
      })
    })

  } catch (e: any) {
    currentInstallProcess = null
    throw e
  }
})

ipcMain.handle('phpenv:cancelInstall', async () => {
  if (currentInstallProcess) {
    currentInstallProcess.killed = true
    currentInstallProcess.kill()
    return true
  }
  return false
})



ipcMain.handle('fpm:getStatus', async (_, port) => {
  const { wsl_distro } = await ensureConfig()
  try {
    const output = await runWsl(wsl_distro, `ss -tlnp 2>/dev/null | grep ':${port} '`)
    return !!output.trim()
  } catch (e) {
    return false
  }
})

ipcMain.handle('fpm:getVersionStatus', async (_, version) => {
  const { wsl_distro, phpenv_root } = await ensureConfig()
  const pidFile = `${phpenv_root}/versions/${version}/var/run/php-fpm.pid`
  try {
    const cmd = `if [ -f '${pidFile}' ]; then kill -0 $(cat '${pidFile}') 2>/dev/null && echo "yes" || echo "no"; else echo "no"; fi`
    const output = await runWsl(wsl_distro, cmd) // normal check doesn't need root usually, but reading pid file owned by root might need it? 
    // Usually pid files are world readable.
    return output.trim() === 'yes'
  } catch (e) {
    return false
  }
})

ipcMain.handle('fpm:start', async (_, { version, port }) => {
  const { wsl_distro, phpenv_root } = await ensureConfig()
  const base = `${phpenv_root}/versions/${version}`
  const sbin = `${base}/sbin/php-fpm`
  const fpmConf = `${base}/etc/php-fpm.conf`
  const wwwConf = `${base}/etc/php-fpm.d/www.conf`
  const pidDir = `${base}/var/run`

  const expected = `listen = 0.0.0.0:${port}`
  const sedCmd = `sed -i 's|^;*\\s*listen\\s*=.*|${expected}|' '${wwwConf}'`

  // Removed sudo, will run as root via wsl -u root
  // We need to be careful with newlines in wsl bash -c
  // Use a single line command or explicit semicolons
  const cmd = `if [ -x '${sbin}' ]; then ${sedCmd}; mkdir -p '${pidDir}'; ${sbin} --fpm-config '${fpmConf}'; else exit 1; fi`
  return runWsl(wsl_distro, cmd, true)
})

ipcMain.handle('fpm:stop', async (_, { version, port }) => {
  const { wsl_distro, phpenv_root } = await ensureConfig()
  const base = `${phpenv_root}/versions/${version}`
  const pidFile = `${base}/var/run/php-fpm.pid`

  // Removed sudo, will run as root via wsl -u root
  // Single line conversion
  const cmd = `if [ -f '${pidFile}' ]; then kill $(cat '${pidFile}') 2>/dev/null || true; fi; fuser -k ${port}/tcp 2>/dev/null || true`
  return runWsl(wsl_distro, cmd, true)
})

ipcMain.handle('extensions:get', async (_, version) => {
  const { wsl_distro, phpenv_root } = await ensureConfig()
  const phpBin = `${phpenv_root}/versions/${version}/bin/php`
  try {
    const output = await runWsl(wsl_distro, `'${phpBin}' -m 2>/dev/null`)
    const lines = output.split('\n')
    const modules: string[] = []
    for (const l of lines) {
      const t = l.trim()
      if (t && !t.startsWith('[') && !t.startsWith('Zend')) modules.push(t)
    }
    return modules.sort()
  } catch (e) {
    return []
  }
})

ipcMain.handle('nginx:reload', async () => {
  // 1. Try "myapp_nginx" directly
  const isMyAppNginx = await new Promise(r => exec('docker ps -q -f name=myapp_nginx', (e, o) => r(!e && !!o.trim())))
  if (isMyAppNginx) {
    return new Promise((resolve, reject) => {
      exec(`docker exec myapp_nginx nginx -s reload`, (err) => {
        if (err) reject('Reload failed: ' + err.message)
        else resolve(true)
      })
    })
  }

  // 2. Fallback to finding via config (if properly set)
  try {
    const cfg = await ensureConfig()
    if (!cfg.compose_file) throw new Error('No compose file')

    return new Promise((resolve, reject) => {
      const cwd = cfg.project_root || path.dirname(cfg.compose_file)
      exec(`docker compose -f "${cfg.compose_file}" ps --format "{{.Name}}"`, { cwd }, (err, stdout) => {
        if (err) return reject(err)
        const nginxContainer = stdout.split('\n').find(l => l.includes('nginx'))
        if (!nginxContainer) return reject('Nginx container not found')

        const containerName = nginxContainer.trim()
        exec(`docker exec ${containerName} nginx -s reload`, (err2) => {
          if (err2) reject(err2)
          else resolve(true)
        })
      })
    })
  } catch (e: any) {
    throw new Error(`Nginx reload failed: Container 'myapp_nginx' is not running, and config-based fallback failed: ${e.message}`)
  }
})

ipcMain.handle('phpenv:openConfig', async (_, { version, type }) => {
  try {
    const { wsl_distro, phpenv_root } = await ensureConfig()
    const base = `${phpenv_root}/versions/${version}`
    let file = ''

    if (type === 'fpm') file = `${base}/etc/php-fpm.conf`
    else if (type === 'www') file = `${base}/etc/php-fpm.d/www.conf`
    else {
      file = `${base}/etc/php.ini`
      // Some versions might be in lib/php.ini ? Try etc first.
    }

    console.log(`[OpenConfig] Request for ${type} in ${version} -> ${file}`)

    // Check existence
    const check = await runWsl(wsl_distro, `[ -f '${file}' ] && echo "yes" || echo "no"`)
    if (check.trim() !== 'yes') {
      // Fallback for php.ini?
      if (type === 'ini') {
        const file2 = `${base}/lib/php.ini`
        const check2 = await runWsl(wsl_distro, `[ -f '${file2}' ] && echo "yes" || echo "no"`)
        if (check2.trim() === 'yes') {
          file = file2
        } else {
          throw new Error(`php.ini not found in etc/ or lib/`)
        }
      } else {
        throw new Error(`File not found: ${file}`)
      }
    }

    const uncPath = `\\\\wsl$\\${wsl_distro}${file.replace(/\//g, '\\')}`
    console.log(`[OpenConfig] Opening UNC Path: ${uncPath}`)

    const res = await shell.openPath(uncPath)
    if (res) {
      throw new Error(`Failed to open: ${res}`)
    }
    return true
  } catch (e: any) {
    console.error('Open config failed:', e)
    throw e
  }
})

ipcMain.handle('db:list', async () => {
  return new Promise((resolve, reject) => {
    console.log('Fetching database list...');
    exec('docker ps --format "{{.Names}}"', (_err, stdout) => {
      const containers = stdout.split('\n').map(c => c.trim()).filter(c => c);
      console.log('Running containers:', containers);

      const dbContainer = containers.find(c => c === 'myapp_db') || containers.find(c => c.includes('db'));

      if (!dbContainer) {
        return reject(new Error(`MySQL container not found. Running: ${containers.join(', ') || '(none)'}`));
      }

      const cmd = `docker exec ${dbContainer} mysql -uroot -prootpassword -N -e "SHOW DATABASES;"`;
      console.log('Executing:', cmd);

      exec(cmd, (error, stdout, stderr) => {
        if (error) {
          console.error('List DB error. Stderr:', stderr);
          reject(new Error(`MySQL Command Failed.\nError: ${error.message}\nStderr: ${stderr}`));
        } else {
          console.log('Databases received:', stdout.trim());
          const dbs = stdout.split('\n').map(s => s.trim()).filter(s => s && s !== 'information_schema' && s !== 'mysql' && s !== 'performance_schema' && s !== 'sys')
          resolve(dbs)
        }
      })
    })
  })
})

ipcMain.handle('app:openDevTools', () => {
  win?.webContents.openDevTools()
})

ipcMain.handle('db:import', async (_, { database, filePath }) => {
  return new Promise((resolve, reject) => {
    console.log(`Importing ${filePath} into ${database}`)

    const child = spawn('docker', ['exec', '-i', 'myapp_db', 'mysql', '-uroot', '-prootpassword', database])

    const fileStream = createReadStream(filePath)
    fileStream.pipe(child.stdin)

    // Handle errors on stream
    fileStream.on('error', (err: any) => {
      reject(err)
      child.kill()
    })

    let stderr = ''
    child.stderr.on('data', (d: any) => stderr += d.toString())

    child.on('close', (code: number) => {
      if (code === 0) resolve(true)
      else reject(new Error(`Import failed (code ${code}): ${stderr}`))
    })

    child.on('error', (err: any) => reject(err))
  })
})

ipcMain.handle('db:getTables', async (_, database) => {
  return new Promise((resolve, reject) => {
    // Basic sanitization
    const safeDb = database.replace(/[^a-zA-Z0-9_]/g, '')
    const query = `SELECT TABLE_NAME, TABLE_ROWS, DATA_LENGTH + INDEX_LENGTH FROM information_schema.TABLES WHERE TABLE_SCHEMA = '${safeDb}'`

    exec(`docker exec myapp_db mysql -uroot -prootpassword -N -e "${query}"`, (error, stdout, stderr) => {
      if (error) {
        console.error('Get Tables error', stderr)
        reject(stderr || error.message)
      } else {
        const tables = stdout.split('\n')
          .map(line => line.trim())
          .filter(line => line)
          .map(line => {
            const [name, rows, size] = line.split('\t')
            return { name, rows: Number(rows || 0), size: Number(size || 0) }
          })
        resolve(tables)
      }
    })
  })
})

// Docker Handlers
ipcMain.handle('docker:check', async () => {
  return new Promise((resolve) => {
    exec('docker ps', (error) => {
      resolve(!error)
    })
  })
})

ipcMain.handle('docker:list', async () => {
  return new Promise((resolve) => {
    exec('docker ps -a --format "{{json .}}"', (error, stdout) => {
      if (error) {
        return resolve([])
      }
      try {
        const lines = stdout.trim().split('\n').filter(Boolean)
        const containers = lines.map(line => JSON.parse(line))
        resolve(containers)
      } catch (e) {
        console.error('Docker parse error', e)
        resolve([])
      }
    })
  })
})

ipcMain.handle('docker:action', async (_, { action, id }) => {
  return new Promise((resolve, reject) => {
    exec(`docker ${action} ${id}`, (error) => {
      if (error) reject(error.message)
      else resolve(true)
    })
  })
})

ipcMain.handle('docker:isInstalled', async () => {
  return new Promise((resolve) => {
    exec('docker -v', (error) => {
      resolve(!error)
    })
  })
})

ipcMain.handle('docker:launch', async () => {
  const p = 'C:\\Program Files\\Docker\\Docker\\Docker Desktop.exe'
  if (existsSync(p)) {
    const { spawn } = await import('node:child_process')
    spawn(p, [], { detached: true, stdio: 'ignore' }).unref()
    return true
  }
  return false
})

ipcMain.handle('docker:setup', async () => {
  shell.openExternal('https://www.docker.com/products/docker-desktop/')
  return true
})



// Helper to check if nginx is running
async function isNginxRunning() {
  return new Promise<boolean>((resolve) => {
    exec('docker ps', (err, stdout) => {
      if (!err && stdout && stdout.includes('myapp_nginx')) {
        resolve(true)
      } else {
        resolve(false)
      }
    })
  })
}

// Helper to perform sync
async function performSync(assignments: Assignment[], composeDir: string, composeFile: string, confDir: string) {
  // Get config for port override if available
  let webPort = "80"
  try {
    const cfg = await ensureConfig()
    if (cfg.web_port) webPort = String(cfg.web_port)
    // Also check if user mentioned 8082 specifically in global config? 
    // For now relying on config. If not present, default to 80.
  } catch (e) { }

  // 1. Generate Nginx Config & Volume Mappings
  let volumeMappings: string[] = []
  let locationBlocks = ''

  // Use a Set to track all unique ports + default
  const exposedPorts = new Set<string>()
  exposedPorts.add(webPort)

  assignments.forEach((a, idx) => {
    const mappingId = `app_${idx}`
    let hostPath = a.doc_root || a.wsl_path || a.win_path
    // On Windows, if path is /mnt/..., convert to Drive:/... for Docker Desktop
    if (process.platform === 'win32' && hostPath && hostPath.startsWith('/mnt/')) {
      const match = hostPath.match(/^\/mnt\/([a-z])\/(.*)$/)
      if (match) {
        hostPath = `${match[1].toUpperCase()}:/${match[2]}`
      }
    }

    if (hostPath) {
      volumeMappings.push(`      - "${hostPath}:/var/www/html/${mappingId}"`)
    }

    // Determine URL path and Port
    let rawUrl = a.url_path || ''
    rawUrl = rawUrl.replace(/^https?:\/\//, '')

    let pathPart = rawUrl

    if (!rawUrl.startsWith('/')) {
      // Parsing host[:port]/path
      const urlMatch = rawUrl.match(/^([^/:]+)(?::(\d+))?(\/.*)?$/)
      if (urlMatch) {
        const port = urlMatch[2]
        const path = urlMatch[3]
        if (port) exposedPorts.add(port)

        if (path) pathPart = path
        else pathPart = '/'
      }
    }

    if (pathPart === 'localhost') pathPart = '/'

    // Ensure absolute path
    if (pathPart && !pathPart.startsWith('/')) pathPart = '/' + pathPart
    if (!pathPart) pathPart = '/'

    // Allow specific handling for root separately or handle consistently
    // If pathPart is '/', it matches root

    // Clean path for regex or plain match
    // If pathPart is /test2, we want location /test2

    const containerPath = `/var/www/html/${mappingId}`

    // Logic for Alias vs Root
    // If path is root '/', use root. If subpath, use alias.
    const directive = pathPart === '/' ? `root ${containerPath};` : `alias ${containerPath}/;`

    // Note on alias: if pathPart is /test2, and request is /test2/foo.php
    // alias /var/www/html/app_X/; maps /test2/ -> /var/www/html/app_X/
    // so /test2/foo.php -> /var/www/html/app_X/foo.php

    locationBlocks += `
    location ${pathPart} {
        ${directive}
        index index.php index.html;
        try_files $uri $uri/ @${mappingId}_rewrites;

        ${(() => {
        const hostRoot = a.doc_root || a.wsl_path || a.win_path.replace(/^([a-zA-Z]):/, (_, d) => `/mnt/${d.toLowerCase()}`).replace(/\\/g, '/');
        const cleanHostRoot = hostRoot.replace(/\/$/, '');

        if (pathPart === '/') {
          return `location ~ \\.php$ {
            fastcgi_pass host.docker.internal:${a.port};
            fastcgi_index index.php;
            include fastcgi_params;
            fastcgi_split_path_info ^(.+\\.php)(/.+)$;
            fastcgi_param SCRIPT_FILENAME "${cleanHostRoot}$fastcgi_script_name";
            fastcgi_param PATH_INFO $fastcgi_path_info;
        }`;
        } else {
          // Ensure regex doesn't have trailing slash
          const cleanPath = pathPart.replace(/\/$/, '');
          // Regex location nested inside the prefix location
          return `location ~ ^${cleanPath}(/.+\\.php)(.*)$ {
            fastcgi_pass host.docker.internal:${a.port};
            fastcgi_index index.php;
            include fastcgi_params;
            
            fastcgi_param SCRIPT_FILENAME "${cleanHostRoot}$1";
            fastcgi_param PATH_INFO $2;
        }`;
        }
      })()}
    }
    
    location @${mappingId}_rewrites {
        rewrite ^${pathPart}/(.*)$ ${pathPart}/index.php?/$1 last;
    }
    
    # Extra block to handle PHP execution for alias if nested location doesn't catch it
    # But nested location above should catch it.
`
  })

  const nginxConfig = `server {
    listen ${webPort} default_server;
    server_name _;
    root /var/www/html;
    index index.php index.html;
    
    # Health check or default
    location = /health {
        return 200 'OK';
    }

${locationBlocks}
}
`

  if (!existsSync(confDir)) mkdirSync(confDir, { recursive: true })
  writeFileSync(path.join(confDir, 'default.conf'), nginxConfig)

  const volumesSection = volumeMappings.length > 0 ? volumeMappings.join('\n') : ''
  const composeContent = `services:
  nginx:
    image: nginx:latest
    container_name: myapp_nginx
    ports:
${Array.from(exposedPorts).map(p => `      - "${p}:${p}"`).join('\n')}
    volumes:
      - ./conf.d:/etc/nginx/conf.d
${volumesSection}
    networks:
      - app_net
    extra_hosts:
      - "host.docker.internal:host-gateway"

  mysql:
    image: mysql:8.0
    container_name: myapp_db
    environment:
      MYSQL_ROOT_PASSWORD: rootpassword
      MYSQL_DATABASE: myapp_db
    ports:
      - "3306:3306"
    volumes:
      - ./mysql_data:/var/lib/mysql
    networks:
      - app_net

  couchbase:
    image: couchbase:latest
    container_name: myapp_couchbase
    ports:
      - "8091-8096:8091-8096"
      - "11210-11211:11210-11211"
    volumes:
      - ./couchbase_data:/opt/couchbase/var
    networks:
      - app_net

networks:
  app_net:
    driver: bridge
`
  if (!existsSync(path.dirname(composeFile))) {
    mkdirSync(path.dirname(composeFile), { recursive: true })
  }
  writeFileSync(composeFile, composeContent, 'utf-8')
  console.log(`Generated/Updated docker-compose.yml at ${composeFile}`)

  return new Promise((resolve, reject) => {
    const up = (cmd: string, cb: (err: any, out: any) => void) => {
      exec(cmd, { cwd: composeDir }, (err, stdout, stderr) => {
        if (err) {
          const msg = (stderr || err.message || '').toString()
          // Check for conflict
          if (msg.includes('is already in use') || msg.includes('Conflict')) {
            console.log(`Conflict detected for ${cmd}. Cleaning up containers...`)
            exec('docker rm -f myapp_db myapp_nginx myapp_couchbase', () => {
              // Retry
              exec(cmd, { cwd: composeDir }, (e2, o2, s2) => {
                if (e2) cb(s2 || e2.message, null)
                else cb(null, o2)
              })
            })
          } else {
            cb(msg, null)
          }
        } else {
          cb(null, stdout)
        }
      })
    }

    up('docker-compose up -d', (err, out) => {
      if (!err) {
        exec('docker exec myapp_nginx nginx -s reload', (_) => resolve(out))
      } else {
        // Fallback to 'docker compose'
        up('docker compose up -d', (err2, out2) => {
          if (!err2) {
            exec('docker exec myapp_nginx nginx -s reload', (_) => resolve(out2))
          } else {
            reject(err2)
          }
        })
      }
    })
  })
}

ipcMain.handle('docker:sync', async (_, assignments: Assignment[], skipIfRunning = false) => {
  const cfg = await ensureConfig()
  const baseDir = cfg.project_root || 'C:\\Projects\\phpenv_nginx'

  if (!existsSync(baseDir)) {
    mkdirSync(baseDir, { recursive: true })
  }

  const composeFile = path.join(baseDir, 'docker-compose.yml')
  const confDir = path.join(baseDir, 'conf.d')

  if (skipIfRunning) {
    const running = await isNginxRunning()
    if (running) return 'Skipped: Container already running'
  }

  return performSync(assignments, baseDir, composeFile, confDir)
})


ipcMain.handle('db:query', async (_, { database, sql }) => {
  return new Promise((resolve, reject) => {
    console.log(`Executing SQL on ${database}: ${sql.substring(0, 50)}...`)

    // Use mysql client inside container
    const child = spawn('docker', ['exec', '-i', 'myapp_db', 'mysql', '-uroot', '-prootpassword', '-D', database])

    child.stdin.write(sql)
    child.stdin.end()

    let stdout = ''
    let stderr = ''

    child.stdout.on('data', (d: any) => stdout += d.toString())
    child.stderr.on('data', (d: any) => stderr += d.toString())

    child.on('close', (code: number) => {
      if (code === 0) resolve(stdout)
      else reject(new Error(`Query failed: ${stderr || stdout}`))
    })

    child.on('error', (err: any) => reject(err))
  })
})

ipcMain.handle('db:importData', async (_, { database, table, filePath, type }) => {
  return new Promise((resolve, reject) => {
    const delimiter = type === 'tsv' ? '\t' : ','
    console.log(`Importing ${type.toUpperCase()} to ${database}.${table} from ${filePath}`)

    if (!existsSync(filePath)) return reject(new Error('File not found'))

    const stream = createReadStream(filePath)
    const rl = createInterface({ input: stream, crlfDelay: Infinity })

    const child = spawn('docker', ['exec', '-i', 'myapp_db', 'mysql', '-uroot', '-prootpassword', '-D', database, '--default-character-set=utf8mb4'])

    child.stdin.write(`SET NAMES utf8mb4;\n`)

    let buffer: string[] = []
    const BATCH_SIZE = 500

    rl.on('line', (line) => {
      if (!line.trim()) return

      const cols = line.split(delimiter).map(v => {
        v = v.trim()
        if (v === 'NULL') return 'NULL'
        if (v.startsWith('"') && v.endsWith('"')) {
          v = v.substring(1, v.length - 1).replace(/""/g, '"')
        } else if (v.startsWith("'") && v.endsWith("'")) {
          v = v.substring(1, v.length - 1).replace(/''/g, "'")
        }
        return `'${v.replace(/\\/g, '\\\\').replace(/'/g, "''")}'`
      })

      const rowVal = `(${cols.join(',')})`
      buffer.push(rowVal)

      if (buffer.length >= BATCH_SIZE) {
        child.stdin.write(`INSERT INTO \`${table}\` VALUES ${buffer.join(',')};\n`)
        buffer = []
      }
    })

    rl.on('close', () => {
      if (buffer.length > 0) {
        child.stdin.write(`INSERT INTO \`${table}\` VALUES ${buffer.join(',')};\n`)
      }
      child.stdin.end()
    })

    let stderr = ''
    child.stderr.on('data', (d: any) => stderr += d.toString())

    child.on('close', (code: number) => {
      if (code === 0) resolve(true)
      else reject(new Error(`Import failed: ${stderr}`))
    })

    child.on('error', (err: any) => reject(err))
  })
})

ipcMain.handle('db:getTableData', async (_, { database, table }) => {
  return new Promise((resolve, reject) => {
    const query = `SELECT * FROM \`${database}\`.\`${table}\` LIMIT 100`

    exec(`docker exec myapp_db mysql -uroot -prootpassword --default-character-set=utf8mb4 -B -e "${query}"`, { maxBuffer: 1024 * 1024 * 10 }, (error, stdout, stderr) => {
      if (error) {
        console.error('getTableData error:', stderr)
        reject(stderr || error.message)
      } else {
        const lines = stdout.trim().split('\n')
        if (lines.length === 0 || (lines.length === 1 && lines[0].trim() === '')) {
          return resolve({ columns: [], rows: [] })
        }

        const columns = lines[0].split('\t').map(c => c.trim())
        if (lines.length === 1) {
          return resolve({ columns, rows: [] })
        }

        const rows = lines.slice(1).map(line => {
          const vals = line.split('\t')
          const row: any = {}
          columns.forEach((col, i) => {
            row[col] = vals[i]
          })
          return row
        })
        resolve({ columns, rows })
      }
    })
  })
})

// Cron Handlers
ipcMain.handle('cron:getData', async () => {
  const jobs = await runCronQuery("SELECT j.*, s.start_time, s.end_time, s.exit_code FROM jobs j LEFT JOIN job_status s ON j.id = s.job_id ORDER BY j.id DESC")
  const envVars = await runCronQuery("SELECT * FROM environment_variables ORDER BY name ASC")
  const wrappers = await runCronQuery("SELECT * FROM wrappers ORDER BY name ASC")
  const settings = await runCronQuery("SELECT * FROM settings")
  const cronUser = settings.find((s: any) => s.name === 'cron_user')?.value || 'root'

  return { jobs, envVars, wrappers, cronUser }
})

ipcMain.handle('couchbase:getBuckets', async (_, { user, password }) => {
  return new Promise((resolve) => {
    const child = spawn('docker', [
      'exec', 'myapp_couchbase',
      'curl', '-s', '-u', `${user}:${password}`,
      'http://127.0.0.1:8091/pools/default/buckets'
    ])

    let stdout = ''
    let stderr = ''
    child.stdout.on('data', d => stdout += d.toString())
    child.stderr.on('data', d => stderr += d.toString())

    child.on('close', (code) => {
      if (code !== 0) {
        console.error('Couchbase GetBuckets Error (Code', code, '):', stderr)
        return resolve([])
      }
      try {
        const data = JSON.parse(stdout)
        if (Array.isArray(data)) {
          const buckets = data.map((b: any) => b.name)
          resolve(buckets)
        } else {
          resolve([])
        }
      } catch (e) {
        console.error('Failed to parse Couchbase buckets:', e, 'Output:', stdout)
        resolve([])
      }
    })

    child.on('error', (err) => {
      console.error('Couchbase GetBuckets Spawn Error:', err)
      resolve([])
    })
  })
})

ipcMain.handle('couchbase:uploadDocument', async (_, { bucket, user, password, filePath, key }) => {
  if (!existsSync(filePath)) throw new Error('File not found')

  try {
    const fileName = path.basename(filePath)
    const docKey = key || fileName
    const content = readFileSync(filePath, 'utf8')


    return new Promise((resolve) => {
      // We use the Couchbase Document REST API (Internal API used by Web Console)
      // This allows setting the raw value of a document.
      // The content must be passed as the 'value' parameter in a form-urlencoded request.

      const curlCmd = `docker exec -i myapp_couchbase curl -X POST -u "${user}:${password}" \
        "http://127.0.0.1:8091/pools/default/buckets/${bucket}/docs/${docKey}" \
        --data-urlencode "value=${content}"`

      exec(curlCmd, (err, stdout, stderr) => {
        const output = stdout + stderr
        if (err || output.includes('error') || output.includes('FAIL')) {
          console.error('Couchbase Doc Upload Error:', output)
          resolve({ success: false, error: 'Upload failed: ' + output })
        } else {
          resolve({ success: true })
        }
      })
    })
  } catch (e: any) {
    return { success: false, error: e.message }
  }
})

ipcMain.handle('couchbase:uploadFile', async (_, { localPath, remotePath }) => {
  return new Promise((resolve) => {
    if (!existsSync(localPath)) {
      return resolve({ success: false, error: 'Local file not found' })
    }

    const args = ['cp', localPath, `myapp_couchbase:${remotePath}`]
    exec(['docker', ...args].join(' '), (err, _stdout, stderr) => {
      if (err) {
        console.error('Couchbase Upload Error:', stderr)
        return resolve({ success: false, error: stderr || err.message })
      }
      resolve({ success: true })
    })
  })
})

ipcMain.handle('cron:saveJob', async (_, job: any) => {
  if (job.id) {
    return await runCronQuery("UPDATE jobs SET command = ?, schedule = ?, description = ? WHERE id = ?", [job.command, job.schedule, job.description, job.id])
  } else {
    return await runCronQuery("INSERT INTO jobs (command, schedule, description) VALUES (?, ?, ?)", [job.command, job.schedule, job.description])
  }
})

ipcMain.handle('cron:deleteJob', async (_, id: number) => {
  return await runCronQuery("DELETE FROM jobs WHERE id = ?", [id])
})

ipcMain.handle('cron:saveEnv', async (_, env: any) => {
  return await runCronQuery("INSERT INTO environment_variables (name, value, description) VALUES (?, ?, ?) ON CONFLICT(name) DO UPDATE SET value=excluded.value, description=excluded.description", [env.name, env.value, env.description])
})

ipcMain.handle('cron:deleteEnv', async (_, id: number) => {
  return await runCronQuery("DELETE FROM environment_variables WHERE id = ?", [id])
})

ipcMain.handle('cron:saveWrapper', async (_, wrapper: any) => {
  return await runCronQuery("INSERT INTO wrappers (name, value, description) VALUES (?, ?, ?) ON CONFLICT(name) DO UPDATE SET value=excluded.value, description=excluded.description", [wrapper.name, wrapper.value, wrapper.description])
})

ipcMain.handle('cron:deleteWrapper', async (_, id: number) => {
  return await runCronQuery("DELETE FROM wrappers WHERE id = ?", [id])
})

ipcMain.handle('cron:saveSettings', async (_, { cronUser }) => {
  return await runCronQuery("INSERT INTO settings (name, value) VALUES ('cron_user', ?) ON CONFLICT(name) DO UPDATE SET value=excluded.value", [cronUser])
})

ipcMain.handle('cron:apply', async () => {
  const { wsl_distro } = await ensureConfig()
  const cronDir = path.dirname(currentSettings.cronDbPath)

  // Generate content in TS
  const content = await generateCrontabContent()
  writeFileSync(path.join(cronDir, 'crontab.txt'), content.replace(/\r\n/g, '\n'))

  const deployScript = path.join(cronDir, 'deploy_cron.sh').replace(/^([a-zA-Z]):/, (_, d) => `/mnt/${d.toLowerCase()}`).replace(/\\/g, '/')

  try {
    const output = await runWsl(wsl_distro, `bash ${deployScript}`, true)
    return { success: true, output }
  } catch (e: any) {
    throw new Error(e)
  }
})
