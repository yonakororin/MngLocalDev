<script setup lang="ts">
import { ref, onMounted, onUnmounted, nextTick, watch, computed } from 'vue'
import { Config, Assignment } from './types'
import { Activity, Server, Database, RefreshCw, Play, Square, Download, Trash2, Plus, Settings, BookOpen, Edit, Eye, Upload, Box, Clock, Layers, ExternalLink } from 'lucide-vue-next'
import { marked } from 'marked'
import ace from 'ace-builds'
import 'ace-builds/src-noconflict/mode-mysql'
import 'ace-builds/src-noconflict/theme-github'
import 'ace-builds/src-noconflict/keybinding-vim'
import 'ace-builds/src-noconflict/keybinding-emacs'

import manualMd from './manual/ja.md?raw'

const activeTab = ref('phpmanager')
const phpManagerTab = ref('assignments')
const config = ref<Config | null>(null)
const assignments = ref<Assignment[]>([])
const versions = ref<string[]>([])
const status = ref<Record<string, boolean>>({}) 
const versionStatus = ref<Record<string, boolean>>({})
const loading = ref(false)
const setupStatus = ref<string | null>(null)
const wslDistros = ref<string[]>([])

// Cron Manager State
const cronTab = ref('jobs')
const cronData = ref({
  jobs: [] as any[],
  envVars: [] as any[],
  wrappers: [] as any[],
  cronUser: 'root'
})
const showCronJobModal = ref(false)
const showCronEnvModal = ref(false)
const showCronWrapperModal = ref(false)
const editingCronItem = ref<any>(null)
const cronSearchQuery = ref('')
const cronJobScheduleInput = ref<HTMLInputElement | null>(null)

// Settings
const settings = ref({
  configPath: '',
  assignmentsPath: ''
})


const loadData = async () => {
  loading.value = true
  try {
    // Load Settings
    const s = await window.ipcRenderer.invoke('app:getPaths')
    settings.value = s

    const cfg = await window.ipcRenderer.invoke('app:getConfig')
    config.value = cfg
    
    const asg = await window.ipcRenderer.invoke('app:getAssignments')
    assignments.value = asg

    try {
      const vers = await window.ipcRenderer.invoke('phpenv:listVersions')
      versions.value = vers
    } catch(e: any) {
      console.error(e)
      console.error(e)
      alert(`Failed to list versions: ${e.message}`)
    }
    


    // Load Databases
    try {
      console.log('App: Requesting DB list on startup...');
      const dbs = await window.ipcRenderer.invoke('db:list')
      console.log('App: Received DBs on startup:', dbs);
      dbList.value = dbs
    } catch(e) { console.warn('App: DB List startup failed', e) }

    // Check status of known ports
    const ports = asg.map((a: Assignment) => a.port)
    const newStatus: Record<string, boolean> = {}
    for (const p of ports) {
      newStatus[p] = await window.ipcRenderer.invoke('fpm:getStatus', p)
    }
    status.value = newStatus
    
    const vStatus: Record<string, boolean> = {}
    for (const v of versions.value) {
      vStatus[v] = await window.ipcRenderer.invoke('fpm:getVersionStatus', v)
    }
    versionStatus.value = vStatus

    const dstrs = await window.ipcRenderer.invoke('app:listWslDistros')
    wslDistros.value = dstrs

    loadCronData()
  } catch (e) {
    console.error(e)
  } finally {
    loading.value = false
  }
}

const loadCronData = async () => {
    try {
        const data = await window.ipcRenderer.invoke('cron:getData')
        cronData.value = data
    } catch(e) {
        console.error('Failed to load cron data:', e)
    }
}

const handleSaveCronJob = async (job: any) => {
    if(!job.command || !job.schedule) {
        alert('Command and Schedule are required.')
        return
    }
    loading.value = true
    try {
        console.log('App: Saving Cron Job:', job)
        await window.ipcRenderer.invoke('cron:saveJob', JSON.parse(JSON.stringify(job)))
        showCronJobModal.value = false
        cronSearchQuery.value = ''
        await loadCronData()
        
        // Auto apply
        const res = await window.ipcRenderer.invoke('cron:apply')
        console.log('App: Cron Apply Result:', res)
        if (res.success && res.serviceStatus) {
            console.log('Cron Service Status:', res.serviceStatus)
        }
    } catch(e: any) { 
        console.error('App: Cron Save/Apply Error:', e)
        alert('Failed to save or apply cron job: ' + e.message) 
    } finally { 
        loading.value = false 
    }
}

const handleDeleteCronJob = async (id: number) => {
    if(!confirm('Delete this job?')) return
    loading.value = true
    try {
        await window.ipcRenderer.invoke('cron:deleteJob', id)
        await loadCronData()
        const res = await window.ipcRenderer.invoke('cron:apply')
        if (res.success && res.serviceStatus) {
            console.log('Cron Service Status after delete:', res.serviceStatus)
        }
    } catch(e: any) { alert(e.message) } finally { loading.value = false }
}

watch(showCronJobModal, async (val) => {
    if (val) {
        await nextTick()
        cronJobScheduleInput.value?.focus()
    }
})

const handleSaveCronEnv = async (env: any) => {
    loading.value = true
    try {
        await window.ipcRenderer.invoke('cron:saveEnv', JSON.parse(JSON.stringify(env)))
        showCronEnvModal.value = false
        await loadCronData()
        await window.ipcRenderer.invoke('cron:apply')
    } catch(e: any) { alert(e.message) } finally { loading.value = false }
}

const handleDeleteCronEnv = async (id: number) => {
    if(!confirm('Delete this environment variable?')) return
    loading.value = true
    try {
        await window.ipcRenderer.invoke('cron:deleteEnv', id)
        await loadCronData()
        await window.ipcRenderer.invoke('cron:apply')
    } catch(e: any) { alert(e.message) } finally { loading.value = false }
}

const handleSaveCronWrapper = async (wrapper: any) => {
    loading.value = true
    try {
        await window.ipcRenderer.invoke('cron:saveWrapper', JSON.parse(JSON.stringify(wrapper)))
        showCronWrapperModal.value = false
        await loadCronData()
        await window.ipcRenderer.invoke('cron:apply')
    } catch(e: any) { alert(e.message) } finally { loading.value = false }
}

const handleDeleteCronWrapper = async (id: number) => {
    if(!confirm('Delete this wrapper?')) return
    loading.value = true
    try {
        await window.ipcRenderer.invoke('cron:deleteWrapper', id)
        await loadCronData()
        await window.ipcRenderer.invoke('cron:apply')
    } catch(e: any) { alert(e.message) } finally { loading.value = false }
}



const handleSaveCronSettings = async () => {
    loading.value = true
    try {
        await window.ipcRenderer.invoke('cron:saveSettings', { cronUser: cronData.value.cronUser })
        const res = await window.ipcRenderer.invoke('cron:apply')
        await loadCronData()
        
        let msg = 'Settings saved and applied.'
        if (res.serviceStatus && res.serviceStatus.toLowerCase().includes('active: active (running)')) {
            msg += '\n\n✅ Cron service is running normally.'
        } else {
            msg += '\n\n⚠️ Cron service might not be running correctly. See Console for details.'
        }
        alert(msg)
    } catch(e: any) { alert(e.message) } finally { loading.value = false }
}

const filteredCronJobs = computed(() => {
    if(!cronSearchQuery.value) return cronData.value.jobs
    const q = cronSearchQuery.value.toLowerCase()
    return cronData.value.jobs.filter(j => 
        j.command.toLowerCase().includes(q) || 
        (j.description && j.description.toLowerCase().includes(q))
    )
})

const highlightCronCommand = (cmd: string) => {
    let html = cmd.replace(/[&<>"']/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m] || m))
    
    cronData.value.wrappers.forEach(w => {
        const target = `\${${w.name}}`
        html = html.split(target).join(`<span style="color: #e879f9; font-weight: bold;">${target}</span>`)
    })
    
    cronData.value.envVars.forEach(e => {
        const target = `\${${e.name}}`
        html = html.split(target).join(`<span style="color: #38bdf8; font-weight: bold;">${target}</span>`)
    })
    
    return html
}

const handleStart = async (version: string, port: number) => {
  loading.value = true
  try {
    await window.ipcRenderer.invoke('fpm:start', { version, port })
    const run = await window.ipcRenderer.invoke('fpm:getStatus', port)
    status.value = { ...status.value, [port]: run }
  } finally {
    loading.value = false
  }
}

const handleStop = async (version: string, port: number) => {
  loading.value = true
  try {
    await window.ipcRenderer.invoke('fpm:stop', { version, port })
    const run = await window.ipcRenderer.invoke('fpm:getStatus', port)
    status.value = { ...status.value, [port]: run }
  } finally {
    loading.value = false
  }
}

// Assignment creation/editing
const showAssignmentModal = ref(false)
const editingAssignmentIndex = ref(-1)
const newAssignment = ref<Assignment>({
  win_path: '',
  php_version: '',
  port: 9100,
  url_path: 'localhost',
  doc_root: '',
  folder: '',
  wsl_path: ''
})

const openAssignmentModal = () => {
  editingAssignmentIndex.value = -1 // New mode
  // Find next available port
  let maxPort = 0
  if(assignments.value && assignments.value.length > 0) {
     assignments.value.forEach(a => {
        const p = Number(a.port)
        if(p > maxPort) maxPort = p
     })
  }

  // If no assignments, default to 9000. Else max + 1
  const nextPort = maxPort === 0 ? 9100 : maxPort + 1

  newAssignment.value = {
    win_path: '',
    php_version: versions.value[0] || '',
    port: nextPort,
    url_path: 'localhost',
    doc_root: '',
    folder: '',
    wsl_path: ''
  }
  showAssignmentModal.value = true
}

const openEditAssignmentModal = (index: number) => {
  editingAssignmentIndex.value = index
  // Deep copy to break reference
  newAssignment.value = JSON.parse(JSON.stringify(assignments.value[index]))
  showAssignmentModal.value = true
}

const selectAssignmentPath = async () => {
   const path = await window.ipcRenderer.invoke('dialog:openDirectory')
   if(path) {
     newAssignment.value.win_path = path
     // auto-guess doc_root as same path but in WSL format
     // C:\Projects\foo -> /mnt/c/Projects/foo
     const driveMatch = path.match(/^([a-zA-Z]):/)
     if(driveMatch) {
        const drive = driveMatch[1].toLowerCase()
        const relativePath = path.substring(2).replace(/\\/g, '/')
        newAssignment.value.doc_root = `/mnt/${drive}${relativePath}`
     } else {
        newAssignment.value.doc_root = path.replace(/\\/g, '/')
     }
   }
}

const saveAssignment = async () => {
  if(!newAssignment.value.win_path || !newAssignment.value.php_version) {
    alert('Please fill in required fields')
    return
  }
  
  loading.value = true
  let shouldRestart = false

  try {
     let rawList: Assignment[] = []
     if(editingAssignmentIndex.value === -1) {
        // Create new
        rawList = [...assignments.value, { ...newAssignment.value }]
     } else {
        // Update existing
        const oldAsg = assignments.value[editingAssignmentIndex.value]
        
        // Stop old process if running
        if(status.value[oldAsg.port]) {
           try {
              await window.ipcRenderer.invoke('fpm:stop', { version: oldAsg.php_version, port: oldAsg.port })
              shouldRestart = true
           } catch(e) {
              console.warn('Failed to stop old process', e)
           }
        }

        rawList = [...assignments.value]
        rawList[editingAssignmentIndex.value] = { ...newAssignment.value }
     }

     // Convert to plain object to avoid Proxy clone issues in IPC
     const list = JSON.parse(JSON.stringify(rawList))
     const ok = await window.ipcRenderer.invoke('app:saveAssignments', list)
     if(ok) {
       if(shouldRestart) {
          try {
             await window.ipcRenderer.invoke('fpm:start', { version: newAssignment.value.php_version, port: newAssignment.value.port })
          } catch(e: any) {
             console.error('Failed to restart process', e)
             alert('Saved, but failed to restart PHP process: ' + e.message)
          }
       }

       alert(editingAssignmentIndex.value === -1 ? 'Assignment created' : 'Assignment updated')
       showAssignmentModal.value = false
       loadData()
       // Sync Docker Env
       await syncDockerEnv(list)
      } else {
       alert('Failed to save')
     }
  } catch(e: any) {
    alert(e.message)
  } finally {
    loading.value = false
  }
}


const deleteAssignment = async (index: number) => {
  if(!confirm('Are you sure you want to delete this assignment?')) return
  
  const target = assignments.value[index]
  loading.value = true
  try {
     // Try to stop if running
     if(status.value[target.port]) {
        try {
           await window.ipcRenderer.invoke('fpm:stop', { version: target.php_version, port: target.port })
        } catch(e) {
           console.warn('Failed to stop service before deletion', e)
        }
     }
     
     const rawList = [...assignments.value]
     rawList.splice(index, 1) // Remove item
     
     // Convert to plain object to avoid Proxy clone issues in IPC
     const list = JSON.parse(JSON.stringify(rawList))
     const ok = await window.ipcRenderer.invoke('app:saveAssignments', list)
      if(ok) {
        loadData()
        await syncDockerEnv(list)
      } else {
       alert('Failed to delete')
     }
  } catch(e: any) {
    alert(e.message)
  } finally {
    loading.value = false
  }
}





interface TableInfo {
  name: string;
  rows: number;
  size: number;
}

const expandedDb = ref<string | null>(null)
const currentTables = ref<TableInfo[]>([])

const toggleDb = async (db: string) => {
   if(expandedDb.value === db) {
      expandedDb.value = null
      currentTables.value = []
   } else {
      expandedDb.value = db
      currentTables.value = []
      loading.value = true
      try {
         const tables = await window.ipcRenderer.invoke('db:getTables', db)
         currentTables.value = tables
      } catch(e: any) {
         alert('Failed to get tables: ' + e.message)
         expandedDb.value = null
      } finally {
         loading.value = false
      }
   }
}

const formatSize = (bytes: number) => {
   if(bytes < 1024) return bytes + ' B'
   if(bytes < 1024*1024) return (bytes/1024).toFixed(1) + ' KB'
   return (bytes/(1024*1024)).toFixed(1) + ' MB'
}

const dbList = ref<string[]>([])
const handleListDbs = async () => {
   loading.value = true
   console.log('App: Requesting DB list via Refresh...');
   try {
      const dbs = await window.ipcRenderer.invoke('db:list')
      console.log('App: Received DBs via Refresh:', dbs);
      dbList.value = dbs
   } catch(e: any) {
      console.error('App: DB List Refresh failed', e)
      alert('Failed to list DBs. Is Docker running? ' + e.message)
   } finally {
      loading.value = false
   }
}



const showSqlModal = ref(false)
const sqlDbTarget = ref('')
const sqlContent = ref('')
const aceRef = ref<HTMLElement | null>(null)
const aceKey = ref(0) 
const sqlMessage = ref<{ text: string, type: 'error' | 'success' } | null>(null)
let aceEditorInstance: any = null
const editorKeybinding = ref('normal')
const isDockerRunning = ref(false)
const isDockerCliInstalled = ref(false)
const dockerContainers = ref<any[]>([])
const dockerLoading = ref(false)

const checkDocker = async () => {
    dockerLoading.value = true
    try {
        isDockerRunning.value = await window.ipcRenderer.invoke('docker:check')
        if(isDockerRunning.value) {
            isDockerCliInstalled.value = true // Implicitly true
            await listContainers() // wait for it
        } else {
            // If not running, check if installed
            isDockerCliInstalled.value = await window.ipcRenderer.invoke('docker:isInstalled')
        }
    } finally {
        dockerLoading.value = false
    }
}

const launchDocker = async () => {
    if(!confirm('Launch Docker Desktop?')) return
    dockerLoading.value = true
    try {
        const ok = await window.ipcRenderer.invoke('docker:launch')
        if(ok) {
            alert('Docker Desktop is starting... Please wait a moment and click Refresh.')
        } else {
            alert('Could not find Docker Desktop executable standard path.')
        }
    } catch(e: any) {
        alert('Launch failed: ' + e.message)
    } finally {
        dockerLoading.value = false
    }
}

const handleInstallDocker = () => {
    window.ipcRenderer.invoke('docker:setup')
}

const listContainers = async () => {
    dockerLoading.value = true
    dockerContainers.value = await window.ipcRenderer.invoke('docker:list')
    dockerLoading.value = false
}

const syncDockerEnv = async (list: Assignment[]) => {
    try {
        if(!isDockerRunning.value) await checkDocker()
        if(!isDockerRunning.value) return 
        
        // docker loading conflict?
        // loading.value = true // Avoid global loading if possible, or use specific
        await window.ipcRenderer.invoke('docker:sync', list)
        console.log('Docker sync complete')
    } catch(e) {
        console.error('Failed to sync Docker', e)
    }
}

const handleDockerAction = async (action: string, id: string) => {
    if(!confirm(`${action} container ${id}?`)) return
    try {
        await window.ipcRenderer.invoke('docker:action', { action, id })
        listContainers()
    } catch(e: any) {
        alert('Action failed: ' + e)
    }
}

const handleSetupEnv = async () => {
    loading.value = true
    try {
        // Use sync to setup environment based on current assignments
        // Even if empty, it creates default nginx/db containers
        const list = assignments.value.length > 0 ? JSON.parse(JSON.stringify(assignments.value)) : []
        await window.ipcRenderer.invoke('docker:sync', list)
        
        alert('Environment setup complete')
        listContainers()
    } catch(e: any) {
        errorMessage.value = 'Setup failed: ' + e
        showErrorModal.value = true
    } finally {
        loading.value = false
    }
}

const hasAppContainers = computed(() => {
    return dockerContainers.value.some(c => c.Names.includes('myapp_nginx') || c.Names.includes('myapp_db'))
})

const isAppRunning = computed(() => {
     return dockerContainers.value.some(c => (c.Names.includes('myapp_nginx') || c.Names.includes('myapp_db')) && c.State === 'running')
})

const handleStartEnv = async () => {
    loading.value = true
    try {
        await window.ipcRenderer.invoke('docker:action', { action: 'start', id: 'myapp_nginx myapp_db' })
        listContainers()
    } catch(e: any) {
        alert('Start failed: ' + e)
    } finally {
        loading.value = false
    }
}

const handleStopEnv = async () => {
    loading.value = true
    try {
        await window.ipcRenderer.invoke('docker:action', { action: 'stop', id: 'myapp_nginx myapp_db' })
        listContainers()
    } catch(e: any) {
        alert('Stop failed: ' + e)
    } finally {
        loading.value = false
    }
}


watch(editorKeybinding, (val: string) => {
    if(!aceEditorInstance) return
    if(val === 'vim') {
        aceEditorInstance.setKeyboardHandler("ace/keyboard/vim")
    } else if (val === 'emacs') {
        aceEditorInstance.setKeyboardHandler("ace/keyboard/emacs")
    } else {
        aceEditorInstance.setKeyboardHandler(null)
    }
    aceEditorInstance.focus()
})

const openAceModal = async () => {
   sqlMessage.value = null 
   
   if (showSqlModal.value) {
       showSqlModal.value = false
       await nextTick()
   }
   
   if (aceEditorInstance) {
       aceEditorInstance.destroy()
       aceEditorInstance = null
   }

   aceKey.value++
   showSqlModal.value = true
   await nextTick()
   
   // Slight delay to ensure DOM is ready
   await new Promise(r => setTimeout(r, 100))
   
   if (aceRef.value) {
       aceRef.value.innerHTML = ''
       aceRef.value.className = ''
       
       aceEditorInstance = ace.edit(aceRef.value, {
           mode: "ace/mode/mysql",
           theme: "ace/theme/github",
           fontSize: "14px",
           showPrintMargin: false,
           useWorker: false,
           readOnly: false
       })
       
       // Apply keybinding
       if(editorKeybinding.value === 'vim') {
           aceEditorInstance.setKeyboardHandler("ace/keyboard/vim")
       } else if (editorKeybinding.value === 'emacs') {
           aceEditorInstance.setKeyboardHandler("ace/keyboard/emacs")
       }

       aceEditorInstance.setValue(sqlContent.value, -1)
       aceEditorInstance.setReadOnly(false)
       aceEditorInstance.setHighlightActiveLine(true)
       
       aceEditorInstance.on('change', () => {
           sqlContent.value = aceEditorInstance.getValue()
       })

       aceEditorInstance.on('focus', () => {
           aceEditorInstance.setReadOnly(false)
       })
       
       aceEditorInstance.resize(true)
       setTimeout(() => {
           if(aceEditorInstance) {
               aceEditorInstance.focus()
                const input = aceEditorInstance.textInput?.getElement()
                if(input) input.focus()
           }
       }, 300)
   }
}

const closeSqlModal = () => {
    if (aceEditorInstance) {
        sqlContent.value = aceEditorInstance.getValue()
        aceEditorInstance.destroy()
        aceEditorInstance = null
    }
    showSqlModal.value = false
}

const executeSql = async () => {
   if(aceEditorInstance) {
       sqlContent.value = aceEditorInstance.getValue()
   }
   if(!sqlContent.value.trim()) return
   loading.value = true
   sqlMessage.value = null
   try {
      const res = await window.ipcRenderer.invoke('db:query', { database: sqlDbTarget.value, sql: sqlContent.value })
      // Success
      sqlMessage.value = { text: 'SQL executed successfully\n' + res, type: 'success' }
      
      // Refresh tables if DB matches
      if(expandedDb.value === sqlDbTarget.value) {
         // force refresh
         expandedDb.value = null
         await toggleDb(sqlDbTarget.value)
      }
      
      // Auto close on success after delay? Or let user close.
      // Let user close or continue.
   } catch(e: any) {
      if (e.message && e.message.includes('already exists')) {
          sqlMessage.value = { text: 'Error: Table already exists.\nIf you intend to modify the schema, please use ALTER TABLE syntax or DROP the table first.\n\nOriginal Error: ' + e.message, type: 'error' }
      } else {
          sqlMessage.value = { text: 'SQL Error: ' + e.message, type: 'error' }
      }
   } finally {
      loading.value = false
   }
}

const handleDropTable = async (db: string, table: string) => {
   if(!confirm(`Are you sure you want to DROP table "${table}" from "${db}"? This cannot be undone.`)) return
   loading.value = true
   try {
      await window.ipcRenderer.invoke('db:query', { database: db, sql: `DROP TABLE \`${table}\`` })
      alert('Table dropped')
      // Refresh
      expandedDb.value = null
      await toggleDb(db)
   } catch(e: any) {
      alert('Failed to drop table: ' + e.message)
   } finally{
      loading.value = false
   }
}

const handleImportTable = async (db: string, table: string) => {
   const file = await window.ipcRenderer.invoke('dialog:openFile')
   if(!file) return
   
   const ext = file.split('.').pop()?.toLowerCase()
   
   if (ext === 'sql') {
       if(!confirm(`Import SQL ${file} into database ${db}?`)) return
       loading.value = true
       try {
           await window.ipcRenderer.invoke('db:import', { database: db, filePath: file })
           alert('Import successful')
           // Refresh
           expandedDb.value = null
           await toggleDb(db)
       } catch(e: any) { alert(e.message) } finally { loading.value = false }
   } else if (ext === 'csv' || ext === 'tsv') {
       if(!confirm(`Import ${ext.toUpperCase()} ${file} into table ${table}?`)) return
       loading.value = true
       try {
           await window.ipcRenderer.invoke('db:importData', { database: db, table: table, filePath: file, type: ext })
           alert('Import successful')
           // Refresh
           expandedDb.value = null
           await toggleDb(db)
       } catch(e: any) { alert(e.message) } finally { loading.value = false }
   } else {
       alert('Unsupported file type: ' + ext)
   }
}

const handleShowDDL = async (db: string, table: string) => {
    loading.value = true
    try {
        const res = await window.ipcRenderer.invoke('db:query', { database: db, sql: `SHOW CREATE TABLE \`${table}\`` })
        let content = res
        // Remove header row if exists
        if(content.trim().startsWith('Table')) {
            content = content.substring(content.indexOf('\n') + 1)
        }
        // Remove table name column (first tab)
        const tabIdx = content.indexOf('\t')
        if(tabIdx > -1) {
            content = content.substring(tabIdx + 1)
        }
        // Handle escaped newlines
        content = content.replace(/\\n/g, '\n').trim()
        
        sqlDbTarget.value = db
        sqlContent.value = content
        await openAceModal()
    } catch(e: any) {
        alert('Failed to get DDL: ' + e.message)
    } finally {
        loading.value = false
    }
}

const handleCreateDb = async () => {
    const name = prompt('Enter new database name:')
    if(!name) return
    loading.value = true
    try {
        await window.ipcRenderer.invoke('db:query', { database: 'mysql', sql: `CREATE DATABASE \`${name}\`` })
        alert('Database created')
        handleListDbs()
    } catch(e: any) { alert(e.message) } finally { loading.value = false }
}

const handleDropDb = async (db: string) => {
    if(!confirm(`Delete database ${db}? This cannot be undone.`)) return
    loading.value = true
    try {
        await window.ipcRenderer.invoke('db:query', { database: 'mysql', sql: `DROP DATABASE \`${db}\`` })
        alert('Database deleted')
        handleListDbs()
    } catch(e: any) { alert(e.message) } finally { loading.value = false }
}

const handleCreateTable = async (db: string) => {
    sqlDbTarget.value = db
    sqlContent.value = 'CREATE TABLE new_table (\n  id INT AUTO_INCREMENT PRIMARY KEY,\n  name VARCHAR(255) NOT NULL\n);'
    await openAceModal()
}

const showDataModal = ref(false)
const dataColumns = ref<string[]>([])
const dataRows = ref<any[]>([])
const viewTargetTable = ref('')

const handleViewData = async (db: string, table: string) => {
    loading.value = true
    try {
        const res = await window.ipcRenderer.invoke('db:getTableData', { database: db, table })
        dataColumns.value = res.columns
        dataRows.value = res.rows
        viewTargetTable.value = `${db}.${table}`
        showDataModal.value = true
    } catch(e: any) {
        alert('Failed to load data: ' + e.message)
    } finally {
        loading.value = false
    }
}

const installableVersions = ref<string[]>([])
const showInstallModal = ref(false)
// Pagination
const currentPage = ref(1)
const itemsPerPage = 10
const paginatedVersions = computed(() => {
  const start = (currentPage.value - 1) * itemsPerPage
  return installableVersions.value.slice(start, start + itemsPerPage)
})
const totalPages = computed(() => Math.ceil(installableVersions.value.length / itemsPerPage))

const handleInstall = async () => {
  loading.value = true
  showInstallModal.value = true
  installableVersions.value = []
  currentPage.value = 1
  try {
    const list = await window.ipcRenderer.invoke('phpenv:listInstallable')
    installableVersions.value = list
  } catch(e) {
    alert('Failed to list installable versions')
    showInstallModal.value = false
  } finally {
    loading.value = false
  }
}

const installingVersion = ref<string | null>(null)
const installLog = ref<string[]>([])

const cancelInstall = async () => {
    if(!confirm('Cancel installation?')) return
    /* Optimistic UI update */
    installingVersion.value = null
    try {
        await window.ipcRenderer.invoke('phpenv:cancelInstall')
    } catch(e) {
        console.error(e)
    }
}

const startInstall = async (v: string) => {
  if(!confirm(`Install PHP ${v}? This may take a while.`)) return
  showInstallModal.value = false
  installingVersion.value = v
  installLog.value = [] // clear logs
  
  // Switch to Versions tab to show progress
  activeTab.value = 'phpmanager'
  phpManagerTab.value = 'versions'
  
  try {
    await window.ipcRenderer.invoke('phpenv:install', v)
    alert(`Installed PHP ${v} successfully.`)
    loadData()
  } catch(e: any) {
    alert(`Install failed: ${e.message}`)
  } finally {
    installingVersion.value = null
  }
}

// Listen for progress
// We need to keep this listener active or add/remove it appropriately
// Since this is setup script, it runs once.
if(window.ipcRenderer) {
   window.ipcRenderer.on('install:progress', (_: any, line: string) => {
      // Only append if installing
      if(installingVersion.value) {
         installLog.value.push(line)
         // Auto scroll
         setTimeout(() => {
            const logEl = document.querySelector('.install-log')
            if(logEl) logEl.scrollTop = logEl.scrollHeight
         }, 10)
      }
   })

   window.ipcRenderer.on('setup:status', (_: any, status: string | null) => {
      setupStatus.value = status
   })
}

// Modals
const showConfirmModal = ref(false)
const confirmMessage = ref('')
const confirmCallback = ref<(()=>void)|null>(null)

const showInfoModal = ref(false)
const infoMessage = ref('')

const showErrorModal = ref(false)
const errorMessage = ref('')

const handleUninstall = async (v: string) => {
  confirmMessage.value = `Are you sure you want to uninstall PHP ${v}? This cannot be undone.`
  showConfirmModal.value = true
  
  confirmCallback.value = async () => {
     showConfirmModal.value = false
     loading.value = true
     try {
       await window.ipcRenderer.invoke('phpenv:uninstall', v)
       loadData()
       infoMessage.value = `PHP ${v} has been uninstalled.`
       showInfoModal.value = true
     } catch(e: any) {
       alert(`Uninstall failed: ${e.message}`)
     } finally {
       loading.value = false
     }
  }
}


const alert = (msg: string) => {
    // Determine if it is an error or success message based on content?
    // For simplicity, if it contains 'failed' or 'Error', treat as error.
    if (msg.toLowerCase().includes('failed') || msg.toLowerCase().includes('error')) {
        errorMessage.value = msg
        showErrorModal.value = true
    } else {
        infoMessage.value = msg
        showInfoModal.value = true
    }
}

const openDevTools = () => {
   window.ipcRenderer.invoke('app:openDevTools')
}

const getBrowserUrl = (a: Assignment) => {
  if (!config.value) return ''
  let host = a.url_path || 'localhost'
  let port = config.value.web_port || 80
  
  let pathPart = ''
  if (!a.win_path) return ''
  
  // Extract file name or folder name
  const parts = a.win_path.split(/[\\/]/)
  const folderName = parts[parts.length - 1]
  
  pathPart = '/' + folderName
  
  if (host.includes('/')) {
     const idx = host.indexOf('/')
     pathPart = host.substring(idx)
     host = host.substring(0, idx)
  } else if (host !== 'localhost' && host !== '') {
     pathPart = '/' + host
     host = 'localhost'
  }
  
  if (!host.includes(':') && port !== 80) {
    host = `${host}:${port}`
  }
  
  return `http://${host}${pathPart}`
}

const handleOpenUrl = (url: string) => {
  window.ipcRenderer.invoke('app:openExternal', url)
}

// Couchbase State
const couchbaseFiles = ref({
  isDragging: false,
  file: null as any
})
const couchbaseBuckets = ref<string[]>([])
const couchbaseImport = ref({
    user: 'Administrator',
    password: 'Administrator',
    bucket: '',
    mode: 'auto'
})
const couchbaseTab = ref('console')
const cbFileTransferInput = ref<HTMLInputElement | null>(null)

const loadCouchbaseBuckets = async () => {
    loading.value = true
    try {
        const buckets = await window.ipcRenderer.invoke('couchbase:getBuckets', {
            user: couchbaseImport.value.user,
            password: couchbaseImport.value.password
        })
        couchbaseBuckets.value = buckets
        if (buckets.length > 0 && !couchbaseImport.value.bucket) {
            couchbaseImport.value.bucket = buckets[0]
        }
    } catch (e) {
        console.error('Failed to load buckets', e)
    } finally {
        loading.value = false
    }
}

const triggerCbFileTransferInput = () => {
    cbFileTransferInput.value?.click()
}
const handleCouchbaseFileTransferDrop = (e: DragEvent) => {
    couchbaseFiles.value.isDragging = false
    const files = e.dataTransfer?.files
    if (files && files.length > 0) {
        couchbaseFiles.value.file = { name: files[0].name, path: (files[0] as any).path }
    }
}
const handleCouchbaseFileTransferSelect = (e: Event) => {
    const target = e.target as HTMLInputElement
    if (target.files && target.files.length > 0) {
        couchbaseFiles.value.file = { name: target.files[0].name, path: (target.files[0] as any).path }
    }
}
const handleDoCouchbaseUpload = async () => {
    const { file } = couchbaseFiles.value
    if (!file) {
        alert('File is required.')
        return
    }

    loading.value = true
    try {
        // Import to Bucket (Single Document)
        const { bucket, user, password } = couchbaseImport.value
        if (!bucket) {
            alert('Target Bucket is required.')
            return
        }
        
        const res = await window.ipcRenderer.invoke('couchbase:uploadDocument', {
            bucket, user, password, filePath: file.path
        })

        if (res.success) {
            alert('File saved as a document in ' + bucket)
            couchbaseFiles.value.file = null
        } else {
            alert('Upload failed: ' + res.error)
        }
    } catch (e: any) {
        alert('Operation Error: ' + e.message)
    } finally {
        loading.value = false
    }
}

watch(activeTab, (newTab) => {
    if (newTab === 'couchbase') {
        loadCouchbaseBuckets()
    }
})

// Settings handlers
const selectFile = async (field: 'configPath' | 'assignmentsPath') => {
  const path = await window.ipcRenderer.invoke('dialog:openFile')
  if (path) {
    settings.value[field] = path
  }
}

const saveSettings = async () => {
  loading.value = true
  try {
    const okPaths = await window.ipcRenderer.invoke('app:updatePaths', JSON.parse(JSON.stringify(settings.value)))
    
    let okConfig = true
    if (config.value) {
      okConfig = await window.ipcRenderer.invoke('app:saveConfig', JSON.parse(JSON.stringify(config.value)))
    }

    if(okPaths && okConfig) {
      alert('Settings saved. reloading...')
      loadData()
    } else {
      alert('Failed to save settings')
    }
  } finally {
    loading.value = false
  }
}




const loadConfig = async () => {
    try {
        const paths = await window.ipcRenderer.invoke('app:getPaths')
        settings.value = paths
    } catch(e) {
        console.error('Failed to load config', e)
    }
}

const manualHtml = ref('')

let cronInterval: any = null
onMounted(async () => {
  await loadConfig()
  await checkDocker() // Check docker on startup
  manualHtml.value = await marked.parse(manualMd)
  loadData()
  
  // Auto refresh cron data every 10 seconds
  cronInterval = setInterval(loadCronData, 10000)
})

onUnmounted(() => {
    if (cronInterval) clearInterval(cronInterval)
})
</script>

<template>
  <div id="layout">
    <div class="sidebar">
      <div class="brand">
        <Activity /> 作業環境管理ツール
      </div>
      

      <div class="nav-item" :class="{ active: activeTab === 'phpmanager' }" @click="activeTab = 'phpmanager'">
        <Server :size="20" /> PHP Manager
      </div>
      <div class="nav-item" :class="{ active: activeTab === 'database' }" @click="activeTab = 'database'">
        <Database :size="20" /> MySQL Manager
      </div>
      <div class="nav-item" :class="{ active: activeTab === 'couchbase' }" @click="activeTab = 'couchbase'">
        <Layers :size="20" /> Couchbase Manager
      </div>
       <div class="nav-item" :class="{ active: activeTab === 'docker' }" @click="activeTab = 'docker'">
         <Box :size="20" /> Docker Manager
       </div>
       <div class="nav-item" :class="{ active: activeTab === 'cron' }" @click="activeTab = 'cron'">
         <Clock :size="20" /> Cron Manager
       </div>
       <div class="nav-item" :class="{ active: activeTab === 'manual' }" @click="activeTab = 'manual'">
         <BookOpen :size="20" /> Manual
       </div>
       <div class="nav-item" :class="{ active: activeTab === 'settings' }" @click="activeTab = 'settings'">
         <Settings :size="20" /> Settings
       </div>

      

    </div>

    <div class="main-content">
      <div v-if="loading" class="loading-overlay">
         <RefreshCw :size="48" class="spin" style="margin-bottom: 1rem;" />
         <div>Loading...</div>
      </div>

      <div v-if="setupStatus" class="loading-overlay" style="background: rgba(0,0,0,0.8); z-index: 10000; color: white;">
         <RefreshCw :size="64" class="spin" style="margin-bottom: 2rem; color: #4ade80;" />
         <div style="font-size: 1.5rem; font-weight: bold; margin-bottom: 0.5rem;">初期セットアップ中...</div>
         <div style="font-size: 1.1rem; opacity: 0.9;">{{ setupStatus }}</div>
         <div style="margin-top: 2rem; font-size: 0.9rem; opacity: 0.7;">これには数分かかる場合があります。しばらくお待ちください。</div>
      </div>
      
      <!-- Database -->
      <div v-if="activeTab === 'database'" class="view-database">
        <div class="header">
    <h2 class="page-title">MySQL Manager</h2>
    <div style="margin-left:auto; display:flex; gap:10px">
        <button class="btn btn-secondary" @click="handleCreateDb">
          <Plus :size="16" /> Create DB
        </button>
        <button class="btn btn-secondary" @click="handleListDbs">
           <RefreshCw :size="16" :class="{ 'spin': loading }" /> Refresh
        </button>
    </div>
  </div>

  <div class="list">
       <div v-if="dbList.length === 0" style="padding: 2rem; color: #666; text-align:center;">
          No databases found or not connected.
       </div>
       <div v-for="db in dbList" :key="db" class="list-item" style="flex-direction: column; align-items: stretch;">
         <div style="display:flex; align-items:center; justify-content:space-between; width:100%; padding: 0.5rem 0; cursor:pointer;" @click="toggleDb(db)">
             <div style="font-weight:bold; display:flex; align-items:center;">
                 <span style="display:inline-block; width:20px; text-align:center; margin-right: 8px; color:#666;">{{ expandedDb === db ? '▼' : '▶' }}</span>
                 <Database :size="16" style="margin-right:8px; color:#666" /> {{ db }}
             </div>
             <div class="actions">

               <button class="btn btn-danger" @click.stop="handleDropDb(db)" title="Delete DB" style="margin-left:5px">
                 <Trash2 :size="16" />
               </button>
             </div>
         </div>
         
         <!-- Tables -->
         <div v-if="expandedDb === db" style="margin-top: 5px; border-top: 1px solid #ddd; padding: 10px; background: #fff; border-radius: 4px; box-shadow: 0 2px 4px rgba(0,0,0,0.1); margin-bottom: 10px;">
              <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:10px;">
                   <strong style="color:#555">Tables</strong>
                   <button class="btn btn-sm btn-secondary" @click.stop="handleCreateTable(db)" style="font-size:0.85em; padding: 4px 8px;">
                      <Plus :size="14" style="margin-right:4px"/> Create Table
                   </button>
              </div>
                    <div v-if="loading && currentTables.length === 0" style="padding:10px; color:#333;">Loading tables...</div>
                    <table v-else style="width:100%; border-collapse: collapse; font-size: 0.9em; background: #fff;">
                        <thead>
                            <tr style="text-align:left; border-bottom: 2px solid #ccc; color: #222; background: #f9f9f9;">
                                <th style="padding: 8px;">Table Name</th>
                                <th style="padding: 8px; text-align:right;">Rows</th>
                                <th style="padding: 8px; text-align:right;">Size</th>
                                <th style="padding: 8px; text-align:right;">Action</th>
                            </tr>
                        </thead>
                        <tbody>
                            <tr v-for="t in currentTables" :key="t.name" style="border-bottom: 1px solid #eee;">
                                <td style="padding: 12px 10px; font-family: monospace; color: #000; font-weight: bold; font-size: 1.4em;">{{ t.name }}</td>
                                <td style="padding: 8px; text-align:right; color: #333;">{{ t.rows.toLocaleString() }}</td>
                                <td style="padding: 8px; text-align:right; color: #333;">{{ formatSize(t.size) }}</td>
                                <td style="padding: 8px; text-align:right;">
                                   <div style="display: flex; gap: 4px; justify-content: flex-end;">
                                       <button class="btn btn-secondary" @click.stop="handleViewData(db, t.name)" style="padding: 2px 6px; font-size: 0.8em;" title="View Data (First 100 rows)">
                                          <Eye :size="14" />
                                       </button>
                                       <button class="btn btn-secondary" @click.stop="handleShowDDL(db, t.name)" style="padding: 2px 6px; font-size: 0.8em;" title="View Definition / Edit Schema">
                                          <Edit :size="14" />
                                       </button>
                                       <button class="btn btn-secondary" @click.stop="handleImportTable(db, t.name)" style="padding: 2px 6px; font-size: 0.8em;" :title="'Import data to ' + t.name">
                                          <Upload :size="14" />
                                       </button>
                                       <button class="btn btn-danger" @click.stop="handleDropTable(db, t.name)" style="padding: 2px 6px; font-size: 0.8em;" :title="'Drop ' + t.name">
                                          <Trash2 :size="14" />
                                       </button>
                                   </div>
                                </td>
                            </tr>
                            <tr v-if="!loading && currentTables.length === 0">
                                <td colspan="4" style="padding: 10px; text-align:center; color:#555;">No tables found (or database is empty)</td>
                            </tr>
                        </tbody>
                    </table>
               </div>
             </div>
        </div>
      </div>

       <!-- Couchbase -->
       <div v-if="activeTab === 'couchbase'" class="view-couchbase" style="height:100%; display:flex; flex-direction:column;">
         <div class="header" style="margin-bottom:0">
           <h2 class="page-title">Couchbase Manager</h2>
         </div>

          <div class="tabs" style="display:flex; border-bottom:1px solid var(--border-color); padding: 0 10px; margin-bottom: 20px;">
            <div @click="couchbaseTab = 'console'" 
                 class="tab-item"
                 :class="{ active: couchbaseTab === 'console' }">
               Console
            </div>
            <div @click="couchbaseTab = 'files'" 
                 class="tab-item"
                 :class="{ active: couchbaseTab === 'files' }">
               File Upload
            </div>
          </div>

          <div style="flex:1; padding: 0 20px 20px 20px; overflow-y:auto;">
            <!-- Console Tab -->
            <div v-if="couchbaseTab === 'console'">
               <div class="card" style="max-width: 600px; padding: 40px; text-align:center; margin: 20px auto; border: 1px solid #e2e8f0; background: white; box-shadow: 0 4px 6px -1px rgba(0,0,0,0.1);">
                  <div style="font-size: 80px; margin-bottom: 20px;">🗄️</div>
                  <h3 style="margin-bottom: 15px; color: #1e293b; font-size: 1.8em;">Couchbase Server</h3>
                  <p style="color: #64748b; margin-bottom: 30px; line-height: 1.6; font-size: 1.1em;">
                    Couchbase is running in a Docker container. Use the Web Console to manage buckets, analytics, and full-text search.
                  </p>
                  
                  <div style="background: #f1f5f9; padding: 20px; border-radius: 12px; margin-bottom: 30px; border: 1px dashed #cbd5e1; text-align: left;">
                    <div style="font-weight: bold; margin-bottom: 10px; color: #334155; display:flex; align-items:center; gap:8px;">
                      <Activity :size="16" /> Access Information:
                    </div>
                    <div style="font-family: 'Cascadia Code', monospace; font-size: 0.95em; color: #475569;">
                      <div style="margin-bottom:5px;">• URL: <span style="color:#2563eb">http://localhost:8091</span></div>
                      <div>• UI Port: 8091</div>
                    </div>
                  </div>

                  <button class="btn btn-primary" style="width:100%; padding: 15px; font-weight:bold; font-size:1.1em; display:flex; align-items:center; justify-content:center; gap:10px; border-radius: 8px;" @click="handleOpenUrl('http://localhost:8091')">
                    <ExternalLink :size="20" /> Open Web Console
                  </button>
               </div>
            </div>

            <!-- File Upload Tab -->
            <div v-if="couchbaseTab === 'files'">
               <div class="card" style="max-width: 700px; margin: 20px auto; padding: 30px; border: 1px solid #e2e8f0; background: white; box-shadow: 0 4px 6px -1px rgba(0,0,0,0.1);">
                  <div style="margin-bottom:20px;">
                     <h3 style="margin: 0; color: #1e293b; font-size: 1.3em; display:flex; align-items:center; gap:8px;">
                       <Box :size="20" /> Upload / Import to Couchbase
                     </h3>
                     <p style="font-size: 0.85em; color: #64748b; margin-top: 5px;">Upload a file to the container disk or import directly into a bucket.</p>
                  </div>

                  <!-- Bucket Fields -->
                  <div style="margin-bottom:25px; padding: 15px; background: #f0f9ff; border-radius: 8px; border: 1px solid #bae6fd;">
                     <div style="display:grid; grid-template-columns: 1fr 1fr; gap:15px; margin-bottom:15px;">
                        <div>
                           <label style="display:block; font-size:0.85em; color:#0369a1; margin-bottom:5px;">Username</label>
                           <input type="text" v-model="couchbaseImport.user" @change="loadCouchbaseBuckets" style="width:100%;" />
                        </div>
                        <div>
                           <label style="display:block; font-size:0.85em; color:#0369a1; margin-bottom:5px;">Password</label>
                           <input type="password" v-model="couchbaseImport.password" @change="loadCouchbaseBuckets" style="width:100%;" />
                        </div>
                     </div>
                     <div style="margin-bottom:5px;">
                        <label style="display:block; font-size:0.85em; color:#0369a1; margin-bottom:5px; display:flex; justify-content:space-between;">
                           Target Bucket
                           <a href="#" @click.prevent="loadCouchbaseBuckets" style="font-size:0.9em; text-decoration:none; color:#0369a1;">Refresh</a>
                        </label>
                        <select v-model="couchbaseImport.bucket" style="width:100%; padding: 8px; border-radius: 6px; border: 1px solid #bae6fd;">
                            <option v-if="couchbaseBuckets.length === 0" value="">-- No buckets found --</option>
                            <option v-for="b in couchbaseBuckets" :key="b" :value="b">{{ b }}</option>
                        </select>
                     </div>
                  </div>

                  <!-- Drop Zone -->
                  <div 
                     class="drop-zone"
                     :class="{ dragging: couchbaseFiles.isDragging }"
                     @dragover.prevent="couchbaseFiles.isDragging = true"
                     @dragleave.prevent="couchbaseFiles.isDragging = false"
                     @drop.prevent="handleCouchbaseFileTransferDrop"
                     @click="triggerCbFileTransferInput"
                     style="border: 2px dashed #cbd5e1; border-radius: 12px; padding: 30px; text-align:center; cursor:pointer; background: #f8fafc; transition: all 0.2s;"
                  >
                     <input type="file" ref="cbFileTransferInput" @change="handleCouchbaseFileTransferSelect" style="display:none" />
                     
                     <div v-if="!couchbaseFiles.file">
                        <Upload :size="30" style="color:#94a3b8; margin-bottom:10px;" />
                        <p style="color:#64748b; font-size:0.95em;">Drag file to upload to bucket</p>
                        
                        <div style="margin-top:10px; padding: 10px; background: #f0f9ff; border-radius: 8px; border: 1px solid #bae6fd; font-size:0.8em;">
                           <strong style="color:#0369a1;">Couchbase Bucket Mode:</strong><br/>
                           Saves the file as one document in the bucket.
                        </div>
                     </div>
                     <div v-else style="display:flex; align-items:center; justify-content:center; gap:12px; background:white; padding:10px; border-radius:8px; border:1px solid #e2e8f0;">
                        <Activity :size="20" style="color:#22c55e" />
                        <div style="text-align:left; flex:1">
                           <div style="font-weight:bold; font-size:0.9em; color:#1e293b; word-break: break-all;">{{ couchbaseFiles.file.name }}</div>
                        </div>
                        <button @click.stop="couchbaseFiles.file = null" style="background:#fee2e2; border:none; color:#ef4444; width:24px; height:24px; border-radius:12px; cursor:pointer; font-weight:bold; display:flex; align-items:center; justify-content:center;">×</button>
                     </div>
                  </div>

                  <button 
                     class="btn btn-primary" 
                     style="width:100%; margin-top:25px; padding: 12px; font-weight:bold;"
                     :disabled="!couchbaseFiles.file || !couchbaseImport.bucket || loading"
                     @click="handleDoCouchbaseUpload"
                  >
                     <RefreshCw v-if="loading" :size="18" class="spin" style="margin-right:8px;" />
                     <span>{{ loading ? 'Uploading...' : 'Upload to Bucket' }}</span>
                  </button>
               </div>
            </div>
          
          <div style="max-width: 600px; margin: 20px auto; padding: 10px; border-left: 4px solid #cbd5e1; background: #f8fafc; border-radius: 0 8px 8px 0;">
            <h4 style="color: #475569; margin: 0 0 10px 10px;">Quick Setup Guide:</h4>
            <ul style="color: #64748b; font-size: 0.95em; padding-left: 30px; line-height: 1.8; margin: 0;">
              <li>Ensure you have run <strong style="color:#334155">"Rebuild / Update"</strong> in Docker Manager.</li>
              <li>Open the console and click <strong style="color:#2563eb">"Setup New Cluster"</strong>.</li>
              <li>Set <code>localhost</code> as the host address if prompted.</li>
              <li>Bucket data is persisted in <code>localmng/phpenv_nginx/couchbase_data</code>.</li>
            </ul>
          </div>
        </div>
      </div>

      <!-- Manual -->
      <div v-if="activeTab === 'manual'" class="view-manual" style="overflow-y:auto; height:100%">
         <div class="markdown-body" v-html="manualHtml"></div>
      </div>



      <!-- PHP Manager (Tabs) -->
      <div v-if="activeTab === 'phpmanager'" class="view-phpmanager" style="height:100%; display:flex; flex-direction:column;">
          <div class="tabs" style="display:flex; border-bottom:1px solid var(--border-color); padding: 0 10px; margin-bottom: 20px;">
            <div @click="phpManagerTab = 'assignments'" 
                 class="tab-item"
                 :class="{ active: phpManagerTab === 'assignments' }">
               Assignments
            </div>
            <div @click="phpManagerTab = 'versions'" 
                 class="tab-item"
                 :class="{ active: phpManagerTab === 'versions' }">
               Versions
            </div>
          </div>

          <div style="flex:1; overflow-y:auto; display:flex; flex-direction:column;">
             <!-- Assignments Content -->
             <div v-if="phpManagerTab === 'assignments'" class="view-assignments" style="flex:1; display:flex; flex-direction:column;">
                <div class="header">
                  <h2 class="page-title">PHP Assignments</h2>
                  <button class="btn btn-primary" @click="openAssignmentModal">
                    <Plus :size="16" /> New Assignment
                  </button>
                </div>
                <div class="list">
                   <div v-for="(a, i) in assignments" :key="i" class="list-item">
                      <div class="list-item-content">
                        <div class="list-item-title">{{ a.win_path }} &gt; <span style="font-weight:normal; font-size: 0.9em; margin-left: 5px;">PHP {{ a.php_version }}</span></div>
                        <div class="list-item-subtitle" style="font-weight:bold; color: #444; margin-top:4px;">
                           <a href="#" @click.prevent="handleOpenUrl(getBrowserUrl(a))" style="color: #007bff; text-decoration: underline;">
                              {{ getBrowserUrl(a) }}
                           </a>
                           <span style="color:#666; font-weight:normal; margin-left:10px;">(FPM Port: {{ a.port }})</span>
                        </div>
                        <div class="list-item-subtitle">DocumentRoot: {{ a.doc_root }}</div>
                      </div>
                     <div class="actions">
                        <span class="badge" :class="status[a.port] ? 'badge-success' : 'badge-error'" style="margin-right: 5px;">
                          {{ status[a.port] ? 'Running' : 'Stopped' }}
                        </span>
                        <button v-if="status[a.port]" class="btn btn-danger" @click="handleStop(a.php_version, a.port)" style="margin-right: 5px;">
                          <Square :size="16" /> Stop
                        </button>
                        <button v-else class="btn btn-secondary" @click="handleStart(a.php_version, a.port)" style="margin-right: 5px;">
                          <Play :size="16" /> Start
                        </button>
                        
                        <button class="btn btn-secondary" style="margin-right: 5px;" @click="openEditAssignmentModal(i)">
                           <Edit :size="16" /> Edit
                        </button>
                        <button class="btn btn-danger" @click="deleteAssignment(i)">
                           <Trash2 :size="16" /> Delete
                        </button>
                     </div>
                   </div>
                </div>
             </div>

             <!-- Versions Content -->
             <div v-if="phpManagerTab === 'versions'" class="view-versions" style="flex:1; display:flex; flex-direction:column;">
                 <div class="header">
                  <h2 class="page-title">PHP Versions</h2>
                  <button class="btn btn-primary" @click="handleInstall">
                    <Download :size="16" /> Install New
                  </button>
                </div>
                <div class="list">
                    <!-- Installing Item -->
                    <div v-if="installingVersion" class="list-item" style="background: #e6f7ff; border-left: 4px solid #1890ff; flex-direction: column;">
                       <div class="list-item-content" style="width: 100%;">
                        <div class="list-item-title" style="color: #004085; font-weight: bold; display:flex; justify-content:space-between; align-items:center;">
                            <span>Installing PHP {{ installingVersion }}...</span>
                            <button class="btn btn-danger" style="font-size:0.8em; padding: 2px 8px;" @click.stop="cancelInstall">Cancel</button>
                         </div>
                         <div class="list-item-subtitle">
                            <div style="width: 100%; background: #ddd; height: 8px; border-radius: 4px; overflow: hidden; margin-top: 5px;">
                               <div style="width: 50%; height: 100%; background: #1890ff;" class="progress-bar-anim"></div>
                            </div>
                            <div style="font-size: 0.8em; margin-top: 4px; color: #333;">Please wait...</div>
                         </div>
                       </div>
                       
                       <!-- Log Output -->
                       <div class="install-log">
                          <div v-for="(line, i) in installLog" :key="i">{{ line }}</div>
                       </div>
                    </div>

                    <div v-for="v in versions" :key="v" class="list-item">
                     <div class="list-item-content">
                       <div class="list-item-title">{{ v }}</div>
                       <div class="list-item-subtitle">{{ config?.phpenv_root }}/versions/{{ v }}</div>
                     </div>
                     <div class="actions">
                       <button class="btn btn-danger" @click="handleUninstall(v)">
                         <Trash2 :size="16" /> Uninstall
                       </button>
                     </div>
                   </div>
                </div>
             </div>
          </div>
      </div>

      <!-- Settings -->
      <div v-if="activeTab === 'settings'" class="view-settings">
        <div class="header">
          <h2 class="page-title">Settings</h2>
          <div style="margin-left:auto; display:flex; gap:10px">
            <button class="btn btn-secondary" @click="openDevTools">Debug</button>
            <button class="btn btn-primary" @click="saveSettings">
               Save Changes
            </button>
          </div>
        </div>
        
        <div class="card">
           <div style="margin-bottom: 1rem;">
             <label style="display:block; margin-bottom:0.5rem">Config JSON Path</label>
             <div style="display:flex; gap:0.5rem">
               <input type="text" v-model="settings.configPath" readonly>
               <button class="btn btn-secondary" @click="selectFile('configPath')">...</button>
             </div>
           </div>

           <div style="margin-bottom: 1rem;">
             <label style="display:block; margin-bottom:0.5rem">Assignments JSON Path</label>
             <div style="display:flex; gap:0.5rem">
               <input type="text" v-model="settings.assignmentsPath" readonly>
               <button class="btn btn-secondary" @click="selectFile('assignmentsPath')">...</button>
             </div>
           </div>

           <div v-if="config" style="margin-bottom: 1rem;">
             <label style="display:block; margin-bottom:0.5rem; color: #333;">WSL Distro</label>
             <select v-model="config.wsl_distro" style="color: #333; background: #fff; width: 100%; padding: 0.5rem; border-radius: 4px; border: 1px solid #ddd;">
               <option v-for="d in wslDistros" :key="d" :value="d">{{ d }}</option>
               <option v-if="wslDistros.length === 0" disabled value="">Distributions not found</option>
             </select>
             <small style="color: #666; display: block; margin-top: 0.25rem;">
               WSL上で動作させるディストリビューションを選択します
             </small>
           </div>
        </div>
      </div>
    
      <!-- Install Modal -->
      <div v-if="showInstallModal" class="modal-overlay">
        <div class="modal">
          <div class="modal-header">
            <h3>Install New PHP Version</h3>
            <button @click="showInstallModal = false" class="btn btn-secondary" style="margin-left:auto">×</button>
          </div>
          <div class="modal-body">
             <div v-if="installableVersions.length === 0" style="padding: 20px; text-align: center; color: #333;">
                Fetching available versions...
             </div>
             <div v-else class="version-list">
               <div v-for="v in paginatedVersions" :key="v" class="version-list-item" @click="startInstall(v)">
                 {{ v }}
               </div>
             </div>
          </div>
          <!-- Pagination Footer -->
          <div class="modal-footer" v-if="installableVersions.length > 0">
             <button class="btn btn-secondary" :disabled="currentPage === 1" @click="currentPage--">&lt; Prev</button>
             <span style="color:#333">Page {{ currentPage }} / {{ totalPages }}</span>
             <button class="btn btn-secondary" :disabled="currentPage === totalPages" @click="currentPage++">Next &gt;</button>
          </div>
        </div>
      </div>

       <!-- Confirmation Modal -->
       <div v-if="showConfirmModal" class="modal-overlay">
          <div class="modal" style="width: 400px; height: auto;">
             <div class="modal-header">
                <h3>Confirmation</h3>
             </div>
             <div class="modal-body" style="padding: 20px; text-align: center; color: #333;">
                <p>{{ confirmMessage }}</p>
             </div>
             <div class="modal-footer">
                <button class="btn btn-secondary" @click="showConfirmModal = false">Cancel</button>
                <button class="btn btn-danger" @click="() => { if(confirmCallback) confirmCallback() }">Confirm</button>
             </div>
          </div>
       </div>

       <!-- Info Modal -->
       <div v-if="showInfoModal" class="modal-overlay">
          <div class="modal" style="width: 400px; height: auto;">
             <div class="modal-header">
                <h3>Information</h3>
             </div>
             <div class="modal-body" style="padding: 20px; text-align: center; color: #333;">
                <p>{{ infoMessage }}</p>
             </div>
             <div class="modal-footer">
                <button class="btn btn-primary" @click="showInfoModal = false">OK</button>
             </div>
          </div>
       </div>

       <!-- Error Modal -->
       <div v-if="showErrorModal" class="modal-overlay">
          <div class="modal" style="width: 500px; max-height:80vh; display:flex; flex-direction:column;">
             <div class="modal-header" style="background: #fee; color: #c00; border-bottom: 1px solid #fcc;">
                <h3>Error</h3>
                <button @click="showErrorModal = false" class="btn btn-secondary" style="margin-left:auto">×</button>
             </div>
             <div class="modal-body" style="padding: 20px; color: #333; display:flex; flex-direction:column;">
                <p style="margin-bottom: 10px; font-weight:bold;">An error occurred:</p>
                <textarea 
                    readonly 
                    style="width: 100%; height: 150px; padding: 10px; border: 1px solid #ccc; border-radius: 4px; resize: vertical; font-family: monospace; background: #fff;"
                    :value="errorMessage"
                    onclick="this.select()"
                ></textarea>
                <div style="font-size: 0.85em; color: #666; margin-top: 5px;">
                   (Click text to select all)
                </div>
             </div>
             <div class="modal-footer" style="background: #fee; border-top: 1px solid #fcc;">
                <button class="btn btn-secondary" @click="showErrorModal = false">Close</button>
             </div>
          </div>
       </div>

       <!-- SQL Modal -->
       <div v-if="showSqlModal" class="modal-overlay">
         <div class="modal" style="width: 600px;">
            <div class="modal-header">
              <h3>Run SQL (Create Table etc.) on {{ sqlDbTarget }}</h3>
              
              <div style="margin-left: auto; display:flex; align-items:center; gap: 10px;">
                  <select v-model="editorKeybinding" style="padding: 2px 5px; border-radius: 4px; border: 1px solid #ccc; font-size: 0.85em;">
                      <option value="normal">Normal</option>
                      <option value="vim">Vim</option>
                      <option value="emacs">Emacs</option>
                  </select>
                  <button @click="closeSqlModal" class="btn btn-secondary">×</button>
              </div>
            </div>
           <div class="modal-body" style="padding: 1rem;">
              <div v-if="sqlMessage" :style="{ padding: '10px', marginBottom: '10px', borderRadius: '4px', background: sqlMessage.type === 'error' ? '#ffeeee' : '#eeffee', color: sqlMessage.type === 'error' ? '#cc0000' : '#006600', border: '1px solid ' + (sqlMessage.type === 'error' ? '#ffcccc' : '#ccffcc'), whiteSpace: 'pre-wrap' }">
                  {{ sqlMessage.text }}
              </div>
              <div :key="aceKey" ref="aceRef" style="width:100%; height: 300px; border:1px solid #ccc;"></div>
           </div>
           <div class="modal-footer">
              <button class="btn btn-secondary" @click="closeSqlModal">Cancel</button>
              <button class="btn btn-primary" @click="executeSql">Run SQL</button>
           </div>
         </div>
       </div>

       <!-- Data Modal -->
       <div v-if="showDataModal" class="modal-overlay">
         <div class="modal" style="width: 800px; max-height: 80vh; display:flex; flex-direction:column;">
           <div class="modal-header">
             <h3>Data: {{ viewTargetTable }} (First 100)</h3>
             <button @click="showDataModal = false" class="btn btn-secondary" style="margin-left:auto">×</button>
           </div>
           <div class="modal-body" style="padding: 0; overflow: auto; flex:1; background: #fff;">
               <table style="width:100%; border-collapse: collapse; font-size: 0.9em; min-width: 600px; color: #333;">
                   <thead style="position: sticky; top: 0; background: #f5f5f5; z-index: 1;">
                       <tr>
                           <th v-for="col in dataColumns" :key="col" style="padding: 8px; border-bottom: 2px solid #ddd; border-right: 1px solid #eee; text-align: left; color: #222; font-weight: bold;">{{ col }}</th>
                       </tr>
                   </thead>
                   <tbody>
                       <tr v-for="(row, idx) in dataRows" :key="idx" style="border-bottom: 1px solid #eee;">
                           <td v-for="col in dataColumns" :key="col" style="padding: 6px 8px; border-right: 1px solid #f9f9f9; color: #333;">{{ row[col] }}</td>
                       </tr>
                       <tr v-if="dataRows.length === 0">
                           <td :colspan="dataColumns.length || 1" style="padding: 20px; text-align: center; color: #888;">No data found</td>
                       </tr>
                   </tbody>
               </table>
           </div>
           <div class="modal-footer">
              <button class="btn btn-secondary" @click="showDataModal = false">Close</button>
           </div>
         </div>
       </div>

       <!-- Assignment Modal -->
       <div v-if="showAssignmentModal" class="modal-overlay">
         <div class="modal">
           <div class="modal-header">
             <h3>{{ editingAssignmentIndex === -1 ? 'New' : 'Edit' }} Assignment</h3>
             <button @click="showAssignmentModal = false" class="btn btn-secondary" style="margin-left:auto">×</button>
           </div>
           <div class="modal-body" style="padding: 1rem;">
              <div style="margin-bottom:1rem">
                <label style="display:block; margin-bottom:0.5rem; color:#333">Project Path (Windows)</label>
                <div style="display:flex; gap:0.5rem">
                   <input type="text" v-model="newAssignment.win_path" style="flex:1" placeholder="C:\Projects\..." readonly />
                   <button class="btn btn-secondary" @click="selectAssignmentPath">...</button>
                </div>
              </div>

              <div style="margin-bottom:1rem">
                <label style="display:block; margin-bottom:0.5rem; color:#333">PHP Version</label>
                <select v-model="newAssignment.php_version" style="width:100%; padding: 0.75rem; border:1px solid #ddd; border-radius:4px; font-size: 1.2rem;">
                   <option v-for="v in versions" :key="v" :value="v">{{ v }}</option>
                </select>
              </div>

              <div style="margin-bottom:1rem">
                 <label style="display:block; margin-bottom:0.5rem; color:#333">PHP-FPM Port</label>
                 <input type="number" v-model.number="newAssignment.port" style="width:100%"/>
              </div>

              <div style="margin-bottom:1rem">
                 <label style="display:block; margin-bottom:0.5rem; color:#333">URL Path</label>
                 <input type="text" v-model="newAssignment.url_path" style="width:100%" placeholder="localhost:8080" />
              </div>

              <div style="margin-bottom:1rem">
                 <label style="display:block; margin-bottom:0.5rem; color:#333">Document Root (WSL/Linux)</label>
                 <input type="text" v-model="newAssignment.doc_root" style="width:100%" placeholder="/mnt/c/Projects/..." />
              </div>
           </div>
           <div class="modal-footer">
              <button class="btn btn-primary" @click="saveAssignment">{{ editingAssignmentIndex === -1 ? 'Create' : 'Save Changes' }}</button>
           </div>
         </div>
       </div>

       
       <!-- Cron Manager -->
       <div v-if="activeTab === 'cron'" class="view-cron" style="height:100%; display:flex; flex-direction:column;">
           <div class="tabs" style="display:flex; border-bottom:1px solid var(--border-color); padding: 0 10px; margin-bottom: 20px;">
                <div @click="cronTab = 'jobs'" class="tab-item" :class="{ active: cronTab === 'jobs' }">Jobs</div>
                <div @click="cronTab = 'env'" class="tab-item" :class="{ active: cronTab === 'env' }">Environment</div>
                <div @click="cronTab = 'wrappers'" class="tab-item" :class="{ active: cronTab === 'wrappers' }">Wrappers</div>
           </div>

           <div style="flex:1; overflow-y:auto; padding: 0 20px 20px 20px;">
               <!-- Jobs Tab -->
               <div v-if="cronTab === 'jobs'">
                    <div class="header" style="margin-bottom: 20px;">
                        <h3 style="margin:0">Cron Jobs</h3>
                        <div style="display:flex; gap:10px">
                            <button class="btn btn-secondary" @click="loadCronData">
                                <RefreshCw :size="16" :class="{ 'spin': loading }" /> Reload
                            </button>
                            <button class="btn btn-primary" @click="editingCronItem = { schedule: '* * * * *', command: '', description: '' }; showCronJobModal = true">
                                <Plus :size="16" /> Add & Apply Job
                            </button>
                        </div>
                    </div>

                    <!-- <div style="margin-bottom: 20px;">
                        <input type="text" v-model="cronSearchQuery" placeholder="Search jobs..." style="width:100%" />
                    </div> -->

                   <div class="list">
                       <div v-for="job in filteredCronJobs" :key="job.id" class="list-item" style="padding: 15px;">
                           <div class="list-item-content" style="flex:1">
                               <div style="display:flex; align-items:center; gap:10px; margin-bottom:5px;">
                                   <span class="badge" style="background:#e0e7ff; color:#4338ca; font-family:monospace">{{ job.schedule }}</span>
                                   <span v-if="job.description" style="color:#666; font-size:0.9em;"># {{ job.description }}</span>
                               </div>
                               <div style="font-family:monospace; background:#f8fafc; color:#334155; padding:8px; border-radius:4px; border:1px solid #e2e8f0; word-break:break-all;" v-html="highlightCronCommand(job.command)"></div>
                               
                               <div v-if="job.start_time" style="margin-top:8px; font-size:0.85em; display:flex; gap:15px; color:#64748b">
                                   <span><span style="color:#0ea5e9; font-weight:bold">Start:</span> {{ job.start_time }}</span>
                                   <span v-if="job.end_time"><span style="color:#8b5cf6; font-weight:bold">End:</span> {{ job.end_time }}</span>
                                   <span v-if="job.exit_code !== null">
                                       <span style="font-weight:bold" :style="{ color: job.exit_code == 0 ? '#22c55e' : '#ef4444' }">
                                           Exit: {{ job.exit_code }}
                                       </span>
                                   </span>
                                   <span v-else-if="job.start_time && !job.end_time" style="color:#f59e0b; font-weight:bold">Running...</span>
                               </div>
                           </div>
                           <div class="actions" style="margin-left:20px">
                               <button class="btn btn-secondary" @click="editingCronItem = { ...job }; showCronJobModal = true">
                                   <Edit :size="16" />
                               </button>
                               <button class="btn btn-danger" @click="handleDeleteCronJob(job.id)">
                                   <Trash2 :size="16" />
                               </button>
                           </div>
                       </div>
                   </div>
               </div>

               <!-- Env Tab -->
                <div v-if="cronTab === 'env'">
                    <div class="header">
                        <h3 style="margin:0">Environment Variables</h3>
                        <div style="display:flex; gap:10px">
                            <button class="btn btn-secondary" @click="loadCronData">
                                <RefreshCw :size="16" :class="{ 'spin': loading }" /> Reload
                            </button>
                            <button class="btn btn-primary" @click="editingCronItem = { name: '', value: '', description: '' }; showCronEnvModal = true">
                                <Plus :size="16" /> Add & Apply Variable
                            </button>
                        </div>
                    </div>
                   <div class="list" style="margin-top:15px">
                       <div v-for="env in cronData.envVars" :key="env.name" class="list-item">
                           <div class="list-item-content">
                               <div style="font-weight:bold; color:#0ea5e9">{{ env.name }}</div>
                               <div style="font-family:monospace; background:#f8fafc; color:#334155; padding:4px 8px; border-radius:4px; margin: 4px 0;">{{ env.value }}</div>
                               <div v-if="env.description" style="font-size:0.85em; color:#666">{{ env.description }}</div>
                           </div>
                           <div class="actions">
                               <button class="btn btn-secondary" @click="editingCronItem = { ...env }; showCronEnvModal = true">
                                   <Edit :size="16" />
                               </button>
                               <button class="btn btn-danger" @click="handleDeleteCronEnv(env.id)">
                                   <Trash2 :size="16" />
                               </button>
                           </div>
                       </div>
                   </div>

                   <hr style="margin: 30px 0; border: 0; border-top: 1px solid #eee;" />

                   <div class="header">
                       <h3 style="margin:0">Settings</h3>
                   </div>
                   <div class="card" style="margin-top:15px; padding:20px">
                        <label style="display:block; margin-bottom:10px">Cron Run User (e.g. root, www-data)</label>
                        <div style="display:flex; gap:10px">
                            <input type="text" v-model="cronData.cronUser" style="flex:1" />
                            <button class="btn btn-primary" @click="handleSaveCronSettings">Save</button>
                        </div>
                   </div>
               </div>

               <!-- Wrappers Tab -->
                <div v-if="cronTab === 'wrappers'">
                    <div class="header">
                        <h3 style="margin:0">Wrapper Definitions</h3>
                        <div style="display:flex; gap:10px">
                            <button class="btn btn-secondary" @click="loadCronData">
                                <RefreshCw :size="16" :class="{ 'spin': loading }" /> Reload
                            </button>
                            <button class="btn btn-primary" @click="editingCronItem = { name: '', value: '', description: '' }; showCronWrapperModal = true">
                                <Plus :size="16" /> Add & Apply Wrapper
                            </button>
                        </div>
                    </div>
                   <div class="list" style="margin-top:15px">
                        <div v-for="w in cronData.wrappers" :key="w.name" class="list-item">
                            <div class="list-item-content">
                                <div style="font-weight:bold; color:#e879f9">{{ w.name }}</div>
                                <div style="font-family:monospace; background:#f8fafc; color:#334155; padding:4px 8px; border-radius:4px; margin: 4px 0;">{{ w.value }}</div>
                                <div v-if="w.description" style="font-size:0.85em; color:#666">{{ w.description }}</div>
                            </div>
                            <div class="actions">
                                <button class="btn btn-secondary" @click="editingCronItem = { ...w }; showCronWrapperModal = true">
                                    <Edit :size="16" />
                                </button>
                                <button class="btn btn-danger" @click="handleDeleteCronWrapper(w.id)">
                                    <Trash2 :size="16" />
                                </button>
                            </div>
                        </div>
                   </div>
               </div>
           </div>
       </div>

       <!-- Docker Manager -->
       <div v-if="activeTab === 'docker'" class="view-docker">
          <div class="header">
             <h2 class="page-title">Docker Manager</h2>
             <button class="btn btn-secondary" @click="checkDocker">
                <RefreshCw :size="16" :class="{ 'spin': dockerLoading }" /> Refresh
             </button>
          </div>
          
          <div style="padding: 1rem;">
             <!-- Not Running State -->
             <div v-if="!isDockerRunning" style="text-align:center; padding: 2rem; background: #f9f9f9; border-radius: 8px;">
                 <Box :size="48" style="color: #ccc; margin-bottom: 1rem;" />
                 <h3>Docker is not running</h3>
                 <p style="color: #666; margin-bottom: 1.5rem;">
                    {{ isDockerCliInstalled ? 'Docker is installed but not running.' : 'Please install Docker Desktop to manage containers.' }}
                 </p>
                 
                 <div style="display:flex; justify-content:center; gap:10px;">
                      <!-- Install Button -->
                      <button v-if="!isDockerCliInstalled" class="btn btn-primary" @click="handleInstallDocker">
                         Install Docker Desktop
                      </button>
                     
                     <!-- Launch Button -->
                     <button v-if="isDockerCliInstalled" class="btn btn-primary" @click="launchDocker">
                        <Play :size="16" /> Start Docker Desktop
                     </button>

                     <button class="btn btn-secondary" @click="checkDocker">
                        <RefreshCw :size="16" :class="{ 'spin': dockerLoading }" /> Retry Check
                     </button>
                 </div>
             </div>

             <!-- Installed State -->
             <div v-else>
                 <!-- Setup Actions -->
                 <div style="margin-bottom: 1.5rem; padding: 1rem; background: #EEF2FF; border-radius: 8px; border: 1px solid #E0E7FF; display:flex; justify-content:space-between; align-items:center;">
                     <div>
                         <h4 style="margin:0 0 5px 0; color: #3730A3;">Development Environment</h4>
                         <p style="margin:0; font-size: 0.9em; color: #4F46E5;">Standard setup: Nginx + MySQL 8.0</p>
                     </div>
                     <div style="display:flex; gap:10px;">
                        <button v-if="hasAppContainers && !isAppRunning" class="btn btn-primary" @click="handleStartEnv" :disabled="dockerLoading">
                             <Play :size="16" /> Start Environment
                        </button>
                        <button v-if="isAppRunning" class="btn btn-danger" @click="handleStopEnv" :disabled="dockerLoading">
                             <Square :size="16" /> Stop Environment
                        </button>
                         <button class="btn btn-secondary" @click="handleSetupEnv" :disabled="dockerLoading" title="Re-create containers with current assignments">
                            <RefreshCw :size="16" /> Rebuild / Update
                         </button>
                     </div>
                 </div>

                 <!-- Container List -->
                 <div v-if="dockerContainers.length === 0" style="text-align:center; padding: 2rem; color: #666;">
                    No containers found. Click "Setup / Run Environment" to start.
                 </div>
                 
                 <div v-else class="table-container">
                     <table>
                         <thead>
                             <tr>
                                 <th>Name</th>
                                 <th>Image</th>
                                 <th>State</th>
                                 <th>Status</th>
                                 <th>Ports</th>
                                 <th>Actions</th>
                             </tr>
                         </thead>
                         <tbody>
                             <tr v-for="c in dockerContainers" :key="c.ID">
                                 <td style="font-weight:bold;">{{ c.Names }}</td>
                                 <td>{{ c.Image }}</td>
                                 <td>
                                     <span class="status-badge" :class="c.Status.startsWith('Up') ? 'status-active' : 'status-inactive'">
                                         {{ c.Status.split(' ')[0] }}
                                     </span>
                                 </td>
                                 <td>{{ c.Status }}</td>
                                 <td>{{ c.Ports }}</td>
                                 <td class="actions">
                                     <button v-if="!c.Status.startsWith('Up')" class="btn btn-secondary" @click="handleDockerAction('start', c.ID)" title="Start">
                                         <Play :size="14" />
                                     </button>
                                     <button v-if="c.Status.startsWith('Up')" class="btn btn-secondary" @click="handleDockerAction('stop', c.ID)" title="Stop">
                                         <Square :size="14" />
                                     </button>
                                     <button class="btn btn-secondary" @click="handleDockerAction('restart', c.ID)" title="Restart">
                                         <RefreshCw :size="14" />
                                     </button>
                                 </td>
                             </tr>
                         </tbody>
                     </table>
                 </div>
             </div>
          </div>
       </div>

    </div>
  </div>

    <!-- Cron Job Modal -->
    <Teleport to="body">
    <div v-if="showCronJobModal" class="modal-overlay">
        <div class="modal">
            <div class="modal-header">
                <h3>{{ editingCronItem?.id ? 'Edit' : 'Add' }} Cron Job</h3>
                <button @click="showCronJobModal = false" class="btn btn-secondary" style="margin-left:auto">×</button>
            </div>
            <div class="modal-body" style="padding:20px">
                <div style="margin-bottom:15px">
                    <label style="display:block; margin-bottom:5px">Schedule (Cron format)</label>
                    <input type="text" ref="cronJobScheduleInput" v-model="editingCronItem.schedule" placeholder="* * * * *" style="width:100%" />
                    <div style="font-size:0.8em; color:#666; margin-top:4px">Min(0-59) Hour(0-23) Day(1-31) Mon(1-12) Week(0-7)</div>
                </div>
                <div style="margin-bottom:15px">
                    <label style="display:block; margin-bottom:5px">Command</label>
                    <textarea v-model="editingCronItem.command" style="width:100%; height:100px" placeholder="/usr/bin/php /path/to/script.php"></textarea>
                </div>
                <div style="margin-bottom:15px">
                    <label style="display:block; margin-bottom:5px">Description (optional)</label>
                    <input type="text" v-model="editingCronItem.description" style="width:100%" />
                </div>
            </div>
            <div class="modal-footer">
                <button class="btn btn-primary" @click="handleSaveCronJob(editingCronItem)">Save and Apply</button>
            </div>
        </div>
    </div>
    </Teleport>

    <!-- Cron Env Modal -->
    <Teleport to="body">
    <div v-if="showCronEnvModal" class="modal-overlay">
        <div class="modal">
            <div class="modal-header">
                <h3>{{ editingCronItem?.id ? 'Edit' : 'Add' }} Environment Variable</h3>
                <button @click="showCronEnvModal = false" class="btn btn-secondary" style="margin-left:auto">×</button>
            </div>
            <div class="modal-body" style="padding:20px">
                <div style="margin-bottom:15px">
                    <label style="display:block; margin-bottom:5px">Variable Name</label>
                    <input type="text" v-model="editingCronItem.name" placeholder="PATH" style="width:100%" />
                </div>
                <div style="margin-bottom:15px">
                    <label style="display:block; margin-bottom:5px">Value</label>
                    <input type="text" v-model="editingCronItem.value" style="width:100%" />
                </div>
                <div style="margin-bottom:15px">
                    <label style="display:block; margin-bottom:5px">Description</label>
                    <input type="text" v-model="editingCronItem.description" style="width:100%" />
                </div>
            </div>
            <div class="modal-footer">
                <button class="btn btn-primary" @click="handleSaveCronEnv(editingCronItem)">Save and Apply</button>
            </div>
        </div>
    </div>
    </Teleport>

    <!-- Cron Wrapper Modal -->
    <Teleport to="body">
    <div v-if="showCronWrapperModal" class="modal-overlay">
        <div class="modal">
            <div class="modal-header">
                <h3>{{ editingCronItem?.id ? 'Edit' : 'Add' }} Wrapper</h3>
                <button @click="showCronWrapperModal = false" class="btn btn-secondary" style="margin-left:auto">×</button>
            </div>
            <div class="modal-body" style="padding:20px">
                <div style="margin-bottom:15px">
                    <label style="display:block; margin-bottom:5px">Wrapper Name</label>
                    <input type="text" v-model="editingCronItem.name" placeholder="PHP_CMD" style="width:100%" />
                </div>
                <div style="margin-bottom:15px">
                    <label style="display:block; margin-bottom:5px">Value (Prefix command)</label>
                    <input type="text" v-model="editingCronItem.value" style="width:100%" />
                </div>
                <div style="margin-bottom:15px">
                    <label style="display:block; margin-bottom:5px">Description</label>
                    <input type="text" v-model="editingCronItem.description" style="width:100%" />
                </div>
            </div>
            <div class="modal-footer">
                <button class="btn btn-primary" @click="handleSaveCronWrapper(editingCronItem)">Save and Apply</button>
            </div>
        </div>
    </div>
    </Teleport>
</template>

<style>
/* Layout tweaks for Vue template binding */
#layout {
  display: flex;
  height: 100vh;
  width: 100vw;
}
.spin {
  animation: spin 1s linear infinite;
}
@keyframes spin { 100% { transform: rotate(360deg); } }
.loading-overlay {
  position: fixed; top: 0; left: 0; width: 100vw; height: 100vh;
  background: rgba(0,0,0,0.5); color: white; z-index: 1000;
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  font-size: 1.5rem; font-weight: bold; backdrop-filter: blur(2px);
}
/* Modal Styles */
.modal-overlay {
  position: fixed; top: 0; left: 0; width: 100vw; height: 100vh;
  background: rgba(0,0,0,0.5); z-index: 11000; display:flex; align-items:center; justify-content:center;
}
.modal {
  background: white; width: 500px; max-height: 80vh; border-radius: 8px; overflow: hidden; display:flex; flex-direction:column;
  box-shadow: 0 4px 12px rgba(0,0,0,0.2);
  color: #1e293b;
}
.modal input, .modal textarea, .modal select {
  color: #333 !important;
  background: #fff !important;
  border: 1px solid #ccc !important;
}
.modal-header {
  padding: 1rem; background: #f0f0f0; border-bottom: 1px solid #ddd; display:flex; align-items:center; color: #333;
}
.modal-body {
  padding: 0; overflow-y: auto; flex: 1; /* Scrollable area */
}
.version-list-item {
  padding: 0.5rem 1rem; border-bottom: 1px solid #eee; cursor: pointer; color: #333; background: #fff;
}
.version-list-item:hover {
  background: #e9ecef; color: #000;
}
.progress-bar-anim {
  width: 50%; height: 100%; background: #1890ff;
  animation: progress 2s infinite ease-in-out;
}
@keyframes progress {
  0% { transform: translateX(-100%); }
  100% { transform: translateX(200%); }
}
.modal-footer {
  padding: 1rem; background: #f0f0f0; border-top: 1px solid #ddd; display:flex; justify-content:center; align-items:center; gap: 1rem;
}
.install-log {
  margin-top: 10px; background: #1e1e1e; color: #eee; font-family: monospace; font-size: 0.8em; padding: 10px; border-radius: 4px; height: 150px; overflow-y: auto; width: 100%; white-space: pre-wrap;
}
</style>

<style>
/* Markdown Styles */
.markdown-body {
  box-sizing: border-box;
  min-width: 200px;
  max-width: 980px;
  margin: 0 auto;
  padding: 30px;
  color: #24292e;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif, "Apple Color Emoji", "Segoe UI Emoji";
  font-size: 16px;
  line-height: 1.6;
  background-color: #fff;
}
.markdown-body h1 {
  border-bottom: 1px solid #eaecef;
  padding-bottom: 0.3em;
  font-size: 2em;
  margin-top: 24px;
  font-weight: 600;
}
.markdown-body h2 {
  border-bottom: 1px solid #eaecef;
  padding-bottom: 0.3em;
  font-size: 1.5em;
  margin-top: 24px;
  font-weight: 600;
}
.markdown-body h3 {
  font-size: 1.25em;
  margin-top: 24px;
  font-weight: 600;
}
.markdown-body p {
  margin-top: 0;
  margin-bottom: 16px;
}
.markdown-body ul {
  padding-left: 2em;
  margin-bottom: 16px;
}
.markdown-body li {
    margin-bottom: 5px;
}
.markdown-body code {
  background-color: rgba(27,31,35,0.05);
  padding: 0.2em 0.4em;
  border-radius: 3px;
  font-family: "SFMono-Regular", Consolas, "Liberation Mono", Menlo, monospace;
}
.markdown-body pre {
  background-color: #f6f8fa;
  padding: 16px;
  overflow: auto;
  border-radius: 3px;
  margin-bottom: 16px;
}
.markdown-body strong {
    font-weight: 600;
    color: #000;
}
</style>
