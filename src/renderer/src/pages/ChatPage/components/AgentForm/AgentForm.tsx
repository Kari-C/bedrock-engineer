import React, { useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import useSetting from '@renderer/hooks/useSetting'
import { AgentFormProps } from './types'
import { useAgentForm } from './useAgentForm'
import { BasicSection } from './BasicSection'
import { SystemPromptSection } from './SystemPromptSection'
import { ScenariosSection } from './ScenariosSection'
import { TagsSection } from './TagsSection'
import { ToolsSection } from './ToolsSection'
// 古いコンポーネントのインポートを削除
// import { CommandsSection } from './CommandsSection'
// import { BedrockAgentsSection } from './BedrockAgentsSection'
// import { KnowledgeBasesSection } from './KnowledgeBasesSection'
import { useAgentGenerator } from '../../hooks/useAgentGenerator'
import { useScenarioGenerator } from '../../hooks/useScenarioGenerator'
import toast from 'react-hot-toast'
import { FiSave } from 'react-icons/fi'
import { useAgentFilter } from '../AgentList'
import { AgentCategory, ToolState } from '@/types/agent-chat'
import { ToolName } from '@/types/tools'

export const AgentForm: React.FC<AgentFormProps> = ({ agent, onSave, onCancel }) => {
  const { t } = useTranslation()
  const { projectPath, agents, getDefaultToolsForCategory } = useSetting()

  const { availableTags } = useAgentFilter(agents)

  const { formData, updateField, handleSubmit } = useAgentForm(agent, onSave)
  const { generateAgentSystemPrompt, generatedAgentSystemPrompt, isGenerating } =
    useAgentGenerator()
  const {
    generateScenarios,
    generatedScenarios,
    isGenerating: isGeneratingScenarios
  } = useScenarioGenerator()

  // エージェント用のツール設定と選択されたカテゴリを管理
  const [agentTools, setAgentTools] = useState<ToolState[]>([])
  const [, setAgentToolNames] = useState<ToolName[]>([]) // 値は使用しないが、setter は必要
  const [agentCategory, setAgentCategory] = useState<AgentCategory>('all')

  const handleAutoGeneratePrompt = async () => {
    if (!formData.name || !formData.description) {
      toast.error(t('pleaseEnterNameAndDescription'))
      return
    }
    await generateAgentSystemPrompt(formData.name, formData.description)
  }

  const handleGenerateScenarios = async () => {
    if (!formData.name || !formData.description || !formData.system) {
      toast.error(t('inputAgentInfoError'))
      return
    }
    await generateScenarios(formData.name, formData.description, formData.system)
  }

  // Update system prompt when generated
  React.useEffect(() => {
    if (generatedAgentSystemPrompt) {
      updateField('system', generatedAgentSystemPrompt)
    }
  }, [generatedAgentSystemPrompt])

  // Update scenarios when generated
  React.useEffect(() => {
    if (generatedScenarios.length > 0) {
      updateField('scenarios', generatedScenarios)
    }
  }, [generatedScenarios])

  // 初期化時にエージェント固有の設定を設定
  useEffect(() => {
    if (agent?.id) {
      // 既存のツール設定があれば使用
      if (agent.tools && agent.tools.length > 0) {
        // ToolName[] から ToolState[] を生成
        const toolStates = getDefaultToolsForCategory('all').map((toolState) => {
          const toolName = toolState.toolSpec?.name as ToolName
          const isEnabled = agent.tools?.includes(toolName) || false
          return { ...toolState, enabled: isEnabled }
        })

        setAgentTools(toolStates)
        setAgentToolNames(agent.tools)
        updateField('tools', agent.tools)
      }

      // 既存カテゴリがあれば設定
      if (agent.category) {
        setAgentCategory(agent.category)
      } else {
        // それ以外の場合は ALL 設定を使用
        const defaultTools = getDefaultToolsForCategory('all')
        const defaultToolNames = defaultTools
          .filter((tool) => tool.enabled)
          .map((tool) => tool.toolSpec?.name as ToolName)
          .filter(Boolean)

        setAgentTools(defaultTools)
        setAgentToolNames(defaultToolNames)
        updateField('tools', defaultToolNames)
        updateField('category', 'all')
      }

      // 許可コマンド設定
      if (agent.allowedCommands) {
        updateField('allowedCommands', agent.allowedCommands)
      } else {
        // デフォルトは空配列
        updateField('allowedCommands', [])
      }

      // Bedrock Agents設定
      if (agent.bedrockAgents) {
        updateField('bedrockAgents', agent.bedrockAgents)
      } else {
        // デフォルトは空配列
        updateField('bedrockAgents', [])
      }

      // Knowledge Bases設定
      if (agent.knowledgeBases) {
        updateField('knowledgeBases', agent.knowledgeBases)
      } else {
        // デフォルトは空配列
        updateField('knowledgeBases', [])
      }
    } else {
      // 新規エージェントの場合の初期設定
      const defaultTools = getDefaultToolsForCategory('all')
      const defaultToolNames = defaultTools
        .filter((tool) => tool.enabled)
        .map((tool) => tool.toolSpec?.name as ToolName)
        .filter(Boolean)

      setAgentTools(defaultTools)
      setAgentToolNames(defaultToolNames)
      updateField('tools', defaultToolNames)
      updateField('category', 'all')
      updateField('allowedCommands', [])
      updateField('bedrockAgents', [])
      updateField('knowledgeBases', [])
    }
  }, [agent, getDefaultToolsForCategory])

  // ツール設定変更のハンドラ
  const handleToolsChange = (tools: ToolState[]) => {
    setAgentTools(tools)

    // ToolState[] から有効なツール名のみを抽出
    const enabledToolNames = tools
      .filter((tool) => tool.enabled)
      .map((tool) => tool.toolSpec?.name as ToolName)
      .filter(Boolean)

    setAgentToolNames(enabledToolNames)
    updateField('tools', enabledToolNames)
  }

  // カテゴリ変更のハンドラ
  const handleCategoryChange = (category: AgentCategory) => {
    setAgentCategory(category)
    updateField('category', category)

    // 選択したカテゴリに応じたツールセットを適用
    const newTools = getDefaultToolsForCategory(category)
    setAgentTools(newTools)

    // ToolState[] から有効なツール名のみを抽出
    const enabledToolNames = newTools
      .filter((tool) => tool.enabled)
      .map((tool) => tool.toolSpec?.name as ToolName)
      .filter(Boolean)

    setAgentToolNames(enabledToolNames)
    updateField('tools', enabledToolNames)
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="space-y-4"
      onClick={(e) => {
        // フォーム全体でクリックイベントの伝播を停止
        e.stopPropagation()
      }}
    >
      <BasicSection
        name={formData.name}
        description={formData.description}
        icon={formData.icon}
        iconColor={formData.iconColor}
        onChange={(field, value) => updateField(field, value)}
      />

      <SystemPromptSection
        system={formData.system}
        name={formData.name}
        description={formData.description}
        onChange={(value) => updateField('system', value)}
        onAutoGenerate={handleAutoGeneratePrompt}
        isGenerating={isGenerating}
        projectPath={projectPath}
        allowedCommands={formData.allowedCommands || []}
        knowledgeBases={formData.knowledgeBases || []}
        bedrockAgents={formData.bedrockAgents || []}
      />

      <ScenariosSection
        scenarios={formData.scenarios}
        name={formData.name}
        description={formData.description}
        system={formData.system}
        onChange={(scenarios) => updateField('scenarios', scenarios)}
        isGenerating={isGeneratingScenarios}
        onAutoGenerate={handleGenerateScenarios}
      />

      <TagsSection
        tags={formData.tags || []}
        availableTags={availableTags}
        onChange={(tags) => updateField('tags', tags)}
      />

      <ToolsSection
        tools={agentTools}
        onChange={handleToolsChange}
        agentCategory={agentCategory}
        onCategoryChange={handleCategoryChange}
        // 統合された設定を渡す
        knowledgeBases={formData.knowledgeBases || []}
        onKnowledgeBasesChange={(kbs) => updateField('knowledgeBases', kbs)}
        allowedCommands={formData.allowedCommands || []}
        onAllowedCommandsChange={(commands) => updateField('allowedCommands', commands)}
        bedrockAgents={formData.bedrockAgents || []}
        onBedrockAgentsChange={(agents) => updateField('bedrockAgents', agents)}
      />

      <div className="flex justify-end pt-4 pb-4 space-x-2">
        <button
          type="button"
          onClick={onCancel}
          className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-200 bg-white dark:bg-gray-800
            border border-gray-300 dark:border-gray-600 rounded-md shadow-sm hover:bg-gray-50 dark:hover:bg-gray-700
            focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 dark:focus:ring-offset-gray-900"
        >
          {t('cancel')}
        </button>
        <button
          type="submit"
          disabled={isGenerating || isGeneratingScenarios}
          className={`flex items-center gap-2 px-4 py-2 text-sm font-medium border rounded-md shadow-sm focus:outline-none focus:ring-2
            focus:ring-offset-2 focus:ring-blue-500 dark:focus:ring-offset-gray-900 transition-all duration-200
            ${
              isGenerating || isGeneratingScenarios
                ? 'text-gray-400 dark:text-gray-500 bg-gray-200 dark:bg-gray-700 border-gray-300 dark:border-gray-600 cursor-not-allowed opacity-70'
                : 'text-white bg-blue-600 dark:bg-blue-700 border-transparent hover:bg-blue-700 dark:hover:bg-blue-600'
            }`}
        >
          {isGenerating || isGeneratingScenarios ? (
            <>
              <svg
                className="w-4 h-4 mr-1 animate-spin"
                xmlns="http://www.w3.org/2000/svg"
                fill="none"
                viewBox="0 0 24 24"
              >
                <circle
                  className="opacity-25"
                  cx="12"
                  cy="12"
                  r="10"
                  stroke="currentColor"
                  strokeWidth="4"
                ></circle>
                <path
                  className="opacity-75"
                  fill="currentColor"
                  d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                ></path>
              </svg>
              <p>{t('generating')}...</p>
            </>
          ) : (
            <>
              <FiSave />
              <p>{t('save')}</p>
            </>
          )}
        </button>
      </div>
    </form>
  )
}
