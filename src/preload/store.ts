import Store from 'electron-store'
import { LLM, InferenceParameters } from '../types/llm'
import { AgentChatConfig, KnowledgeBase, SendMsgKey, ToolState } from '../types/agent-chat'
import { CustomAgent } from '../types/agent-chat'
import { CommandSettings } from '../main/api/command/types'

const DEFAULT_SHELL = '/bin/bash'
const DEFAULT_INFERENCE_PARAMS: InferenceParameters = {
  maxTokens: 4096,
  temperature: 0.5,
  topP: 0.9
}

type StoreScheme = {
  userDataPath?: string // Add userDataPath to store
  projectPath?: string
  llm?: LLM
  inferenceParams: InferenceParameters
  language: 'ja' | 'en'
  agentChatConfig: AgentChatConfig
  tools: ToolState[]
  websiteGenerator: {
    knowledgeBaseId: string
    enableKnowledgeBase: boolean
    modelId: string
  }
  tavilySearch: {
    apikey: string
  }
  apiEndpoint: string
  advancedSetting: {
    keybinding: {
      sendMsgKey: SendMsgKey
    }
  }
  aws: {
    region: string
    accessKeyId: string
    secretAccessKey: string
  }
  customAgents: CustomAgent[]
  selectedAgentId: string
  knowledgeBases: KnowledgeBase[]
  command: CommandSettings
}

const electronStore = new Store<StoreScheme>()
console.log('store path', electronStore.path)

const init = () => {
  // Initialize userDataPath if not present
  const userDataPath = electronStore.get('userDataPath')
  if (!userDataPath) {
    // This will be set from main process
    electronStore.set('userDataPath', '')
  }

  const pjPath = electronStore.get('projectPath')
  if (!pjPath) {
    const defaultProjectPath = process.env[process.platform == 'win32' ? 'USERPROFILE' : 'HOME']
    electronStore.set('projectPath', defaultProjectPath)
  }

  const keybinding = electronStore.get('advancedSetting')?.keybinding
  if (!keybinding) {
    electronStore.set('advancedSetting', {
      keybinding: {
        sendMsgKey: 'Enter'
      }
    })
  }

  const language = electronStore.get('language')
  if (language === undefined) {
    electronStore.set('language', 'en')
  }

  // Initialize AWS settings if not present
  const awsConfig = electronStore.get('aws')
  if (!awsConfig) {
    electronStore.set('aws', {
      region: 'us-west-2',
      accessKeyId: '',
      secretAccessKey: ''
    })
  }

  // Initialize inference parameters if not present
  const inferenceParams = electronStore.get('inferenceParams')
  if (!inferenceParams) {
    electronStore.set('inferenceParams', DEFAULT_INFERENCE_PARAMS)
  }

  // Initialize custom agents if not present
  const customAgents = electronStore.get('customAgents')
  if (!customAgents) {
    electronStore.set('customAgents', [])
  }

  // Initialize selected agent id if not present
  const selectedAgentId = electronStore.get('selectedAgentId')
  if (!selectedAgentId) {
    electronStore.set('selectedAgentId', 'softwareAgent')
  }

  // Initialize knowledge bases
  const knowledgeBases = electronStore.get('knowledgeBases')
  if (!knowledgeBases) {
    electronStore.set('knowledgeBases', [])
  }

  // Initialize command settings if not present
  const commandSettings = electronStore.get('command')
  if (!commandSettings) {
    electronStore.set('command', {
      allowedCommands: [
        {
          pattern: 'ls *',
          description: 'List directory contents'
        }
      ],
      shell: DEFAULT_SHELL
    })
  }
  // シェル設定が存在しない場合は追加
  else if (!commandSettings.shell) {
    electronStore.set('command', {
      ...commandSettings,
      shell: DEFAULT_SHELL
    })
  }
}

init()

type Key = keyof StoreScheme
export const store = {
  get<T extends Key>(key: T) {
    return electronStore.get(key)
  },
  set<T extends Key>(key: T, value: StoreScheme[T]) {
    return electronStore.set(key, value)
  }
}

export type ConfigStore = typeof store
