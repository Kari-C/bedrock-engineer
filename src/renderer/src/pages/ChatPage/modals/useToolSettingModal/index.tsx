import { useSettings } from '@renderer/contexts/SettingsContext'
import toast from 'react-hot-toast'
import { ToolName, isMcpTool } from '@/types/tools'
import { PlanModeCompatibilityBadge } from './PlanModeCompatibilityBadge'
import { toolIcons } from '../../components/Tool/ToolIcons'
import { KnowledgeBaseSettingForm } from './KnowledgeBaseSettingForm'
import { CommandForm } from './CommandForm'
import { BedrockAgentSettingForm } from './BedrockAgentSettingForm'
import { TavilySearchSettingForm } from './TavilySearchSettingForm'
import { ThinkToolSettingForm } from './ThinkToolSettingForm'
import { RecognizeImageSettingForm } from './RecognizeImageSettingForm'
import { GenerateImageSettingForm } from './GenerateImageSettingForm'
import { FlowSettingForm } from './FlowSettingForm'
import { Button, Modal, ToggleSwitch } from 'flowbite-react'
import { memo, useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
// ローカルで型定義
import { ToolState } from '@/types/agent-chat'
// JSONViewerコンポーネントのインポート
import JSONViewer from '@renderer/components/JSONViewer'
import { TOOL_CATEGORIES } from '../../components/AgentForm/ToolsSection/utils/toolCategories'

export interface CommandConfig {
  pattern: string
  description: string
}

// 利用可能なシェルのリスト
export const AVAILABLE_SHELLS = [
  { value: '/bin/bash', label: 'Bash' },
  { value: '/bin/zsh', label: 'Zsh' },
  { value: '/bin/sh', label: 'Shell' }
]

// 詳細設定が必要なツール
const TOOLS_WITH_SETTINGS = [
  'executeCommand',
  'retrieve',
  'invokeBedrockAgent',
  'tavilySearch',
  'recognizeImage',
  'generateImage',
  'invokeFlow'
]

interface ToolSettingModalProps {
  isOpen: boolean
  onClose: () => void
}

interface ToolItemProps {
  toolName: string
  enabled: boolean
  onToggle: () => void
  onSelect: () => void
  isSelected: boolean
}

const ToolItem: React.FC<ToolItemProps> = ({
  toolName,
  enabled,
  onToggle,
  onSelect,
  isSelected
}) => {
  const { t } = useTranslation()
  const isMcp = isMcpTool(toolName)

  return (
    <li
      className={`
        border-b border-gray-100 dark:border-gray-600 transition-colors duration-150
        ${isSelected ? 'bg-blue-50 dark:bg-blue-900/30 border-l-2 !border-l-blue-500 dark:!border-l-blue-400' : 'border-l-2 border-l-transparent'}
        ${isMcp ? 'bg-cyan-50 dark:bg-cyan-900/20' : ''}
        cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-700/70 w-full
      `}
      onClick={() => onSelect()}
    >
      <div className="py-3 px-1 flex items-center justify-center lg:justify-between">
        <div className="flex items-center lg:gap-2.5 w-full justify-center lg:justify-start">
          <div
            className={`flex-shrink-0 w-7 h-7 flex items-center justify-center
                        ${isSelected ? 'text-blue-600 dark:text-blue-400' : 'text-gray-500 dark:text-gray-300'}`}
            title={toolName}
          >
            {toolIcons[toolName as ToolName]}
          </div>
          <div className="lg:block hidden">
            <div className="flex items-center gap-2">
              <span
                className={`text-sm font-medium text-gray-700 dark:text-gray-100
                              ${isSelected ? 'text-blue-700 dark:text-blue-300' : ''}`}
              >
                {toolName}
              </span>
              {isMcp && (
                <span className="bg-cyan-100 text-cyan-800 text-xs font-medium px-2 py-0.5 rounded dark:bg-cyan-800/50 dark:text-cyan-200">
                  MCP
                </span>
              )}
            </div>
            <p className="text-xs text-gray-500 dark:text-gray-300 mt-0.5 line-clamp-1">
              {t(`tool descriptions.${toolName}`, isMcp ? 'MCP Tool' : '')}
            </p>
          </div>
        </div>
        <div
          onClick={(e) => e.stopPropagation()}
          className="flex-shrink-0 lg:pl-2 pl-0 lg:block hidden"
        >
          {isMcp ? (
            <div className="flex items-center">
              <span className="text-xs text-cyan-600 dark:text-cyan-300 mr-2">Always enabled</span>
              <ToggleSwitch checked={true} onChange={() => {}} disabled={true} label="" />
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <PlanModeCompatibilityBadge toolName={toolName} />
              <ToggleSwitch checked={enabled} onChange={() => onToggle()} label="" />
            </div>
          )}
        </div>
      </div>
    </li>
  )
}

export const useToolSettingModal = () => {
  const [show, setShow] = useState(false)
  const handleOpen = () => {
    setShow(true)
  }
  const handleClose = () => {
    setShow(false)
  }

  return {
    show: show,
    handleOpen: handleOpen,
    handleClose: handleClose,
    ToolSettingModal: ToolSettingModal
  }
}

interface ToolSettingModalProps {
  isOpen: boolean
  onClose: () => void
}

const ToolSettingModal = memo(({ isOpen, onClose }: ToolSettingModalProps) => {
  const { t } = useTranslation()
  const {
    customAgents,
    selectedAgentId,
    updateAgentTools,
    getAgentTools,
    currentLLM,
    shell,
    setShell,
    tavilySearchApiKey,
    setTavilySearchApiKey,
    getAgentAllowedCommands,
    updateAgentAllowedCommands,
    getAgentKnowledgeBases,
    updateAgentKnowledgeBases,
    getAgentBedrockAgents,
    updateAgentBedrockAgents,
    getAgentFlows,
    updateAgentFlows
  } = useSettings()

  // 選択されたツールの状態管理
  const [selectedTool, setSelectedTool] = useState<string | null>(null)
  const [selectedToolBody, setSelectedToolBody] = useState<ToolState>()

  // エージェントのツール設定
  const [agentTools, setAgentTools] = useState<ToolState[]>([])

  // 現在選択中のエージェント
  const currentAgent = customAgents.find((agent) => agent.id === selectedAgentId)

  // エージェントが選択されているかどうかを確認
  const hasSelectedAgent = !!selectedAgentId && !!currentAgent

  // エージェントのツール設定を読み込む
  useEffect(() => {
    if (selectedAgentId) {
      const tools = getAgentTools(selectedAgentId)
      setAgentTools(tools)
    }
  }, [selectedAgentId, getAgentTools])

  const handleToggleTool = (toolName: string) => {
    // MCP ツールの場合は何もしない（常に有効）
    if (isMcpTool(toolName)) {
      return
    }

    if (!currentLLM.toolUse) {
      toast(`${currentLLM.modelName} does not support ToolUse.`)
      return
    }

    if (!selectedAgentId) return

    const updatedTools = agentTools.map((tool) => {
      if (tool.toolSpec?.name === toolName) {
        return { ...tool, enabled: !tool.enabled }
      }
      return tool
    })
    setAgentTools(updatedTools)

    // エージェントの設定を更新
    updateAgentTools(selectedAgentId, updatedTools)
  }

  const selectTool = (toolName: string) => {
    setSelectedTool(toolName === selectedTool ? null : toolName)
    setSelectedToolBody(agentTools.find((tool) => tool.toolSpec?.name === toolName))
  }

  // 各カテゴリのツールを取得する
  const getToolsByCategory = () => {
    const toolsByCategory = TOOL_CATEGORIES.map((category) => {
      // MCP カテゴリの場合は MCP ツールのみを含める
      if (category.isMcpCategory) {
        const mcpTools =
          agentTools?.filter((tool) => tool.toolSpec?.name && isMcpTool(tool.toolSpec.name)) || []

        return {
          ...category,
          toolsData: mcpTools
        }
      }

      // 通常のカテゴリの場合は MCP ツール以外を含める
      const toolsInCategory =
        agentTools?.filter(
          (tool) =>
            tool.toolSpec?.name &&
            category.tools.includes(tool.toolSpec.name) &&
            !isMcpTool(tool.toolSpec.name)
        ) || []

      return {
        ...category,
        toolsData: toolsInCategory
      }
    })

    // ツールがないカテゴリは表示しない
    return toolsByCategory.filter((category) => category.toolsData.length > 0)
  }

  const categorizedTools = getToolsByCategory()

  return (
    <Modal
      dismissible
      size="7xl"
      show={isOpen}
      onClose={onClose}
      className="dark:bg-gray-800 border border-gray-200 dark:border-gray-500 shadow-lg dark:shadow-gray-900/50"
    >
      <Modal.Header className="border-b border-gray-200 dark:border-gray-600 dark:bg-gray-800 dark:text-white rounded-t-lg">
        {hasSelectedAgent ? (
          <div className="flex items-center">
            <span>Agent Tools: </span>
            <span className="font-medium ml-3">{currentAgent?.name}</span>
          </div>
        ) : (
          <div>
            Agent Tools
            <div className="text-sm font-normal text-gray-500 dark:text-gray-300 mt-1">
              {t('Select an agent first to edit tool settings')}
            </div>
          </div>
        )}
      </Modal.Header>

      <Modal.Body className="p-0 h-[700px] dark:bg-gray-800 rounded-b-lg">
        <div className="flex h-full w-full rounded-lg">
          {/* 左側サイドバー：ツールリスト - fixed height with own scrollbar */}
          <div className="lg:w-1/3 w-[60px] border-r border-gray-200 dark:border-gray-600 overflow-y-auto h-full max-h-[700px] flex-shrink-0 dark:bg-gray-800 rounded-bl-lg">
            <div className="h-full">
              {/* カテゴリごとのセクション */}
              {categorizedTools.map((category) => (
                <div key={category.id} className="mb-4">
                  {/* カテゴリヘッダー - 背景色と影を追加して重なり防止 */}
                  <div className="p-3 bg-gray-50 dark:bg-gray-700 font-medium sticky top-0 z-20 shadow-sm lg:block hidden">
                    <div className="text-sm text-gray-700 dark:text-gray-100 font-semibold">
                      {t(`Tool Categories.${category.name}`)}
                    </div>
                    <div className="text-xs text-gray-500 dark:text-gray-300 mt-1">
                      {t(`Tool Categories.${category.name} Description`)}
                    </div>
                  </div>

                  {/* ツールリスト */}
                  <ul className="divide-y divide-gray-100 dark:divide-gray-600">
                    {category.toolsData.map((tool) => {
                      const toolName = tool.toolSpec?.name
                      if (!toolName) return null

                      const isSelected = selectedTool === toolName

                      return (
                        <ToolItem
                          key={toolName}
                          toolName={toolName}
                          enabled={tool.enabled}
                          onToggle={() => handleToggleTool(toolName)}
                          onSelect={() => selectTool(toolName)}
                          isSelected={isSelected}
                        />
                      )
                    })}
                  </ul>
                </div>
              ))}
            </div>
          </div>

          {/* 右側: 設定コンテンツエリア - separate scrollable area */}
          <div className="lg:w-2/3 flex-1 overflow-y-auto h-full max-h-[700px] dark:bg-gray-800 rounded-br-lg">
            {selectedTool ? (
              <div className="p-4">
                <div className="sticky top-0 pt-1 pb-3 bg-white dark:bg-gray-800 z-20 mb-4 border-b border-gray-200 dark:border-gray-700">
                  <h3 className="text-lg font-medium dark:text-white pb-3">{selectedTool}</h3>
                </div>

                {isMcpTool(selectedTool) ? (
                  // MCP ツールの詳細表示
                  <div className="prose dark:prose-invert max-w-none">
                    <div className="flex items-center gap-2 mb-4">
                      <p className="text-gray-700 dark:text-gray-100 font-bold mb-0">
                        {selectedTool}
                      </p>
                      <span className="bg-cyan-100 text-cyan-800 text-xs font-medium px-2 py-0.5 rounded dark:bg-cyan-800/50 dark:text-cyan-200">
                        MCP
                      </span>
                    </div>

                    <p className="mb-4 text-gray-700 dark:text-gray-200">
                      {selectedToolBody?.toolSpec?.description ?? ''}
                    </p>

                    {/* JSONViewerコンポーネントを使用 */}
                    <JSONViewer
                      data={selectedToolBody?.toolSpec}
                      title="Tool Specification (JSON)"
                      maxHeight="400px"
                      showCopyButton={true}
                    />
                  </div>
                ) : TOOLS_WITH_SETTINGS.includes(selectedTool) ? (
                  <div className="w-full">
                    <div className="prose dark:prose-invert max-w-none mb-4">
                      <div className="flex items-center gap-2 mb-4">
                        <p className="text-gray-700 dark:text-gray-100 font-bold mb-0">
                          {t(`tool descriptions.${selectedTool}`)}
                        </p>
                        <PlanModeCompatibilityBadge toolName={selectedTool} />
                      </div>
                    </div>
                    {selectedTool === 'retrieve' && selectedAgentId && (
                      <KnowledgeBaseSettingForm
                        knowledgeBases={getAgentKnowledgeBases(selectedAgentId)}
                        setKnowledgeBases={(kbs) => updateAgentKnowledgeBases(selectedAgentId, kbs)}
                      />
                    )}
                    {selectedTool === 'executeCommand' && selectedAgentId && (
                      <CommandForm
                        allowedCommands={getAgentAllowedCommands(selectedAgentId)}
                        setAllowedCommands={(commands) =>
                          updateAgentAllowedCommands(selectedAgentId, commands)
                        }
                        shell={shell}
                        setShell={setShell}
                      />
                    )}
                    {selectedTool === 'invokeBedrockAgent' && selectedAgentId && (
                      <BedrockAgentSettingForm
                        bedrockAgents={getAgentBedrockAgents(selectedAgentId)}
                        setBedrockAgents={(agents) =>
                          updateAgentBedrockAgents(selectedAgentId, agents)
                        }
                      />
                    )}
                    {selectedTool === 'tavilySearch' && (
                      <TavilySearchSettingForm
                        tavilySearchApiKey={tavilySearchApiKey}
                        setTavilySearchApiKey={setTavilySearchApiKey}
                      />
                    )}
                    {selectedTool === 'recognizeImage' && <RecognizeImageSettingForm />}
                    {selectedTool === 'generateImage' && <GenerateImageSettingForm />}
                    {selectedTool === 'think' && <ThinkToolSettingForm />}
                    {selectedTool === 'invokeFlow' && selectedAgentId && (
                      <FlowSettingForm
                        flows={getAgentFlows(selectedAgentId)}
                        setFlows={(flows) => updateAgentFlows(selectedAgentId, flows)}
                      />
                    )}
                  </div>
                ) : (
                  <div className="prose dark:prose-invert max-w-none">
                    <div className="flex items-center gap-2 mb-4">
                      <p className="text-gray-700 dark:text-gray-100 font-bold mb-0">
                        {t(`tool descriptions.${selectedTool}`)}
                      </p>
                      <PlanModeCompatibilityBadge toolName={selectedTool} />
                    </div>

                    <p className="mb-2 text-gray-700 dark:text-gray-200">
                      {t(
                        `tool usage.${selectedTool}.description`,
                        `This tool can be used by the AI assistant when enabled.`
                      )}
                    </p>

                    <div className="bg-blue-50 dark:bg-gray-800/80 dark:border dark:border-blue-700 p-4 rounded-md mt-4">
                      <h5 className="font-medium mb-2 dark:text-blue-300">{t('Tip')}</h5>
                      <p className="text-sm text-gray-700 dark:text-gray-200">
                        {t(
                          `tool usage.${selectedTool}.tip`,
                          `Toggle the switch to enable or disable this tool.`
                        )}
                      </p>
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center h-[700px] text-center text-gray-500 dark:text-gray-200 p-4">
                <div className="text-5xl mb-4">🛠️</div>
                <p className="text-base">{t('Select a tool from the list')}</p>
                <p className="text-sm mt-2">
                  {t('Click on any tool to view details and configuration options')}
                </p>
              </div>
            )}
          </div>
        </div>
      </Modal.Body>
      <Modal.Footer className="dark:bg-gray-800 dark:border-t dark:border-gray-600 rounded-b-lg">
        <Button
          onClick={onClose}
          className="dark:bg-blue-600 dark:hover:bg-blue-700 dark:text-white"
        >
          {t('Close')}
        </Button>
      </Modal.Footer>
    </Modal>
  )
})

ToolSettingModal.displayName = 'ToolSettingModal'

export default ToolSettingModal
