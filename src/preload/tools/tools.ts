import { ToolService } from './toolService'
import { store } from '../store'
import { BedrockService } from '../../main/api/bedrock'
import { ToolInput, ToolResult } from '../../types/tools'
import { createPreloadCategoryLogger } from '../logger'
import { CommandPatternConfig } from '../../main/api/command/types'

// Create logger for tools module
const logger = createPreloadCategoryLogger('tools')

export const executeTool = async (input: ToolInput): Promise<string | ToolResult> => {
  const toolService = new ToolService()
  const bedrock = new BedrockService({ store })

  logger.info(`Executing tool: ${input.type}`, {
    toolName: input.type,
    toolParams: JSON.stringify(input)
  })

  try {
    switch (input.type) {
      case 'createFolder':
        return toolService.createFolder(input.path)

      case 'readFiles':
        return toolService.readFiles(input.paths, input.options)

      case 'writeToFile':
        return toolService.writeToFile(input.path, input.content)

      case 'applyDiffEdit':
        return toolService.applyDiffEdit(input.path, input.originalText, input.updatedText)

      case 'listFiles': {
        const defaultIgnoreFiles = store.get('agentChatConfig')?.ignoreFiles
        const options = {
          ...input.options,
          ignoreFiles: input.options?.ignoreFiles || defaultIgnoreFiles
        }
        return toolService.listFiles(input.path, options)
      }

      case 'moveFile':
        return toolService.moveFile(input.source, input.destination)

      case 'copyFile':
        return toolService.copyFile(input.source, input.destination)

      case 'tavilySearch': {
        const apiKey = store.get('tavilySearch').apikey
        return toolService.tavilySearch(input.query, apiKey)
      }

      case 'fetchWebsite':
        return toolService.fetchWebsite(input.url, input.options)

      case 'generateImage':
        return toolService.generateImage(bedrock, {
          prompt: input.prompt,
          outputPath: input.outputPath,
          modelId: input.modelId,
          negativePrompt: input.negativePrompt,
          aspect_ratio: input.aspect_ratio,
          seed: input.seed,
          output_format: input.output_format
        })

      case 'retrieve':
        return toolService.retrieve(bedrock, {
          knowledgeBaseId: input.knowledgeBaseId,
          query: input.query
        })

      case 'invokeBedrockAgent': {
        const projectPath = store.get('projectPath')!
        return toolService.invokeBedrockAgent(bedrock, projectPath, {
          agentId: input.agentId,
          agentAliasId: input.agentAliasId,
          sessionId: input.sessionId,
          inputText: input.inputText,
          file: input.file
        })
      }

      case 'executeCommand': {
        // 基本的なシェル設定を取得
        const shell = store.get('shell')

        // 現在選択されているエージェントIDを取得
        const selectedAgentId = store.get('selectedAgentId')

        // エージェント固有の許可コマンドを取得
        let allowedCommands: CommandPatternConfig[] = []
        if (selectedAgentId) {
          // カスタムエージェントから許可コマンドを取得
          const customAgents = store.get('customAgents') || []
          const currentAgent = customAgents.find((agent) => agent.id === selectedAgentId)
          if (currentAgent && currentAgent.allowedCommands) {
            allowedCommands = currentAgent.allowedCommands
          }
        }

        const commandConfig = {
          allowedCommands,
          shell
        }

        if ('pid' in input && 'stdin' in input && input?.pid && input?.stdin) {
          return toolService.executeCommand(
            {
              pid: input.pid,
              stdin: input.stdin
            },
            commandConfig
          )
        } else if ('command' in input && 'cwd' in input && input?.command && input?.cwd) {
          return toolService.executeCommand(
            {
              command: input.command,
              cwd: input.cwd
            },
            commandConfig
          )
        }

        const errorMessage =
          'Invalid input format for executeCommand: requires either (command, cwd) or (pid, stdin)'
        logger.error(errorMessage)
        throw new Error(errorMessage)
      }

      case 'think':
        return toolService.think(input.thought)
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error)
    logger.error(`Error executing tool: ${input.type}`, { error: errorMessage })
    throw error
  }
}
