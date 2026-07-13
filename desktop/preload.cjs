const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('portabase', Object.freeze({
  state: () => ipcRenderer.invoke('portabase:state'),
  saveConfig: config => ipcRenderer.invoke('portabase:save-config', config),
  saveSecrets: values => ipcRenderer.invoke('portabase:save-secrets', values),
  run: request => ipcRenderer.invoke('portabase:run', request),
  listOrganizations: token => ipcRenderer.invoke('portabase:list-organizations', token),
  listProjects: token => ipcRenderer.invoke('portabase:list-projects', token),
  saveSettings: settings => ipcRenderer.invoke('portabase:save-settings', settings),
  createProject: request => ipcRenderer.invoke('portabase:create-project', request),
  projectCredentials: request => ipcRenderer.invoke('portabase:project-credentials', request),
  chooseDirectory: () => ipcRenderer.invoke('portabase:choose-directory'),
  chooseCapsule: () => ipcRenderer.invoke('portabase:choose-capsule'),
  importLicense: () => ipcRenderer.invoke('portabase:import-license'),
  installSchedule: everyHours => ipcRenderer.invoke('portabase:install-schedule', everyHours),
  removeSchedule: () => ipcRenderer.invoke('portabase:remove-schedule'),
  open: url => ipcRenderer.invoke('portabase:open', url),
  openReport: reportPath => ipcRenderer.invoke('portabase:open-report', reportPath),
  onStream: callback => ipcRenderer.on('portabase:stream', (_event, chunk) => callback(String(chunk))),
}));
