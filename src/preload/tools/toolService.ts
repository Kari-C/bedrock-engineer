import * as fs from 'fs/promises'
import * as path from 'path'
import GitignoreLikeMatcher from '../lib/gitignore-like-matcher'
import { ipcRenderer } from 'electron'
import { ContentChunker, ContentChunk } from '../lib/contentChunker'
import { ToolResult } from '../../types/tools'
import { CommandService } from '../../main/api/command/commandService'
import {
  CommandConfig,
  CommandInput,
  CommandStdinInput,
  ProcessInfo
} from '../../main/api/command/types'
import {
  BedrockService,
  ImageGeneratorModel,
  AspectRatio,
  OutputFormat
} from '../../main/api/bedrock'
import { FileUseCase, InvokeAgentCommandOutput } from '@aws-sdk/client-bedrock-agent-runtime'
import { InvokeAgentInput } from '../../main/api/bedrock/services/agentService'

interface GenerateImageResult extends ToolResult {
  name: 'generateImage'
  result: {
    imagePath: string
    modelUsed: string
    seed?: number
    prompt: string
    negativePrompt?: string
    aspect_ratio: string
  }
}

interface RetrieveResult extends ToolResult {
  name: 'retrieve'
}

type Completion = {
  message?: string
  files?: string[]
  // traces: TracePart[]
}

type InvokeAgentResultOmitFile = {
  $metadata: InvokeAgentCommandOutput['$metadata']
  contentType: InvokeAgentCommandOutput['contentType']
  sessionId: InvokeAgentCommandOutput['sessionId']
  completion?: Completion
}

interface InvokeBedrockAgentResult extends ToolResult<InvokeAgentResultOmitFile> {
  name: 'invokeBedrockAgent'
}

interface ExecuteCommandResult extends ToolResult {
  name: 'executeCommand'
  stdout: string
  stderr: string
  exitCode: number
  processInfo?: ProcessInfo
  requiresInput?: boolean
  prompt?: string
}

// コマンドサービスのインスタンスとその設定を保持
interface CommandServiceState {
  service: CommandService
  config: CommandConfig
}

let commandServiceState: CommandServiceState | null = null

export class ToolService {
  private getCommandService(config: CommandConfig): CommandService {
    // 設定が変更された場合は新しいインスタンスを作成
    if (
      !commandServiceState ||
      JSON.stringify(commandServiceState.config) !== JSON.stringify(config)
    ) {
      commandServiceState = {
        service: new CommandService(config),
        config
      }
    }
    return commandServiceState.service
  }

  async createFolder(folderPath: string): Promise<string> {
    try {
      await fs.mkdir(folderPath, { recursive: true })
      return `Folder created: ${folderPath}`
    } catch (e: any) {
      throw `Error creating folder: ${e.message}`
    }
  }

  async writeToFile(filePath: string, content: string): Promise<string> {
    try {
      await fs.writeFile(filePath, content)
      return `Content written to file: ${filePath}\n\n${content}`
    } catch (e: any) {
      throw `Error writing to file: ${e.message}`
    }
  }

  async applyDiffEdit(
    path: string,
    originalText: string,
    updatedText: string
  ): Promise<ToolResult> {
    try {
      // ファイルの内容を読み込む
      const fileContent = await fs.readFile(path, 'utf-8')

      // 元のテキストが存在するか確認
      if (!fileContent.includes(originalText)) {
        return {
          name: 'applyDiffEdit',
          success: false,
          error: 'Original text not found in file',
          result: null
        }
      }

      // テキストを置換
      const newContent = fileContent.replace(originalText, updatedText)

      // ファイルに書き込む
      await fs.writeFile(path, newContent, 'utf-8')

      return {
        name: 'applyDiffEdit',
        success: true,
        message: 'Successfully applied diff edit',
        result: {
          path,
          originalText,
          updatedText
        }
      }
    } catch (error) {
      return {
        name: 'applyDiffEdit',
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error occurred',
        result: null
      }
    }
  }

  async readFiles(filePaths: string[]): Promise<string> {
    try {
      const fileContents = await Promise.all(
        filePaths.map(async (filePath) => {
          const content = await fs.readFile(filePath, 'utf-8')
          return { path: filePath, content }
        })
      )

      const result = fileContents
        .map(({ path, content }) => {
          return `File: ${path}\n${'='.repeat(path.length + 6)}\n${content}\n\n`
        })
        .join('')

      return result
    } catch (e: any) {
      throw `Error reading multiple files: ${e.message}`
    }
  }

  async listFiles(dirPath: string, prefix: string = '', ignoreFiles?: string[]): Promise<string> {
    try {
      const files = await fs.readdir(dirPath, { withFileTypes: true })
      const matcher = new GitignoreLikeMatcher(ignoreFiles ?? [])
      let result = ''

      for (let i = 0; i < files.length; i++) {
        const file = files[i]
        const isLast = i === files.length - 1
        const currentPrefix = prefix + (isLast ? '└── ' : '├── ')
        const nextPrefix = prefix + (isLast ? '    ' : '│   ')
        const filePath = path.join(dirPath, file.name)
        const relativeFilePath = path.relative(process.cwd(), filePath)

        if (ignoreFiles && ignoreFiles.length && matcher.isIgnored(relativeFilePath)) {
          continue
        }

        if (file.isDirectory()) {
          result += `${currentPrefix}📁 ${file.name}\n`
          result += await this.listFiles(filePath, nextPrefix)
        } else {
          result += `${currentPrefix}📄 ${file.name}\n`
        }
      }

      return result
    } catch (e: any) {
      throw `Error listing directory structure: ${e}`
    }
  }

  async moveFile(source: string, destination: string): Promise<string> {
    try {
      await fs.rename(source, destination)
      return `File moved: ${source} to ${destination}`
    } catch (e: any) {
      throw `Error moving file: ${e.message}`
    }
  }

  async copyFile(source: string, destination: string): Promise<string> {
    try {
      await fs.copyFile(source, destination)
      return `File copied: ${source} to ${destination}`
    } catch (e: any) {
      throw `Error copying file: ${e.message}`
    }
  }

  async tavilySearch(query: string, apiKey: string): Promise<any> {
    try {
      const response = await fetch('https://api.tavily.com/search', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          api_key: apiKey,
          query,
          search_depth: 'advanced',
          include_answer: true,
          include_images: true,
          include_raw_content: true,
          max_results: 5,
          include_domains: [],
          exclude_domains: []
        })
      })

      const body = await response.json()
      return {
        success: true,
        name: 'tavilySearch',
        message: `Searched using Tavily. Query: ${query}`,
        result: body
      }
      // return JSON.stringify(body, null, 2)
    } catch (e: any) {
      throw `Error searching: ${e.message}`
    }
  }

  async fetchWebsite(
    url: string,
    options?: RequestInit & { chunkIndex?: number; cleaning?: boolean }
  ): Promise<string> {
    try {
      const { chunkIndex, ...requestOptions } = options || {}
      const chunkStore: Map<string, ContentChunk[]> = global.chunkStore || new Map()
      let chunks: ContentChunk[] | undefined = chunkStore.get(url)

      if (!chunks) {
        const response = await ipcRenderer.invoke('fetch-website', url, requestOptions)
        const rawContent =
          typeof response.data === 'string' ? response.data : JSON.stringify(response.data, null, 2)
        chunks = ContentChunker.splitContent(rawContent, { url }, { cleaning: options?.cleaning })
        chunkStore.set(url, chunks)
        global.chunkStore = chunkStore
      }

      if (typeof chunkIndex === 'number') {
        if (!chunks || chunks.length === 0) {
          throw new Error('No content chunks available')
        }

        if (chunkIndex < 1 || chunkIndex > chunks.length) {
          throw new Error(`Invalid chunk index. Available chunks: 1 to ${chunks.length}`)
        }

        const chunk = chunks[chunkIndex - 1]
        const content = options?.cleaning
          ? ContentChunker.extractMainContent(chunk.content)
          : chunk.content
        return `Chunk ${chunk.index}/${chunk.total}:\n\n${content}`
      }

      if (chunks.length === 1) {
        return `Content successfully retrieved:\n\n${chunks[0].content}`
      }

      return this.createChunkSummary(chunks)
    } catch (e: any) {
      throw `Error fetching website: ${e.message}`
    }
  }

  private createChunkSummary(chunks: ContentChunk[]): string {
    const summary = [
      `Content successfully retrieved and split into ${chunks.length} chunks:`,
      `URL: ${chunks[0].metadata?.url}`,
      `Timestamp: ${new Date(chunks[0].metadata?.timestamp ?? '').toISOString()}`,
      '\nTo retrieve specific chunks, use the fetchWebsite tool with chunkIndex option:',
      `Total Chunks: ${chunks.length}`,
      'Example usage:',
      '```',
      `fetchWebsite("${chunks[0].metadata?.url}", { chunkIndex: 1 })`,
      '```\n'
    ].join('\n')

    return summary
  }

  async generateImage(
    bedrock: BedrockService,
    toolInput: {
      prompt: string
      outputPath: string
      modelId: ImageGeneratorModel
      negativePrompt?: string
      aspect_ratio?: AspectRatio
      seed?: number
      output_format?: OutputFormat
    }
  ): Promise<GenerateImageResult> {
    const {
      prompt,
      outputPath,
      modelId,
      negativePrompt,
      aspect_ratio,
      seed,
      output_format = 'png'
    } = toolInput

    try {
      const result = await bedrock.generateImage({
        modelId,
        prompt,
        negativePrompt,
        aspect_ratio,
        seed,
        output_format
      })

      if (!result.images || result.images.length === 0) {
        throw new Error('No image was generated')
      }

      const imageData = result.images[0]
      const binaryData = Buffer.from(imageData, 'base64')
      await fs.writeFile(outputPath, new Uint8Array(binaryData))

      return {
        success: true,
        name: 'generateImage',
        message: `Image generated successfully and saved to ${outputPath}`,
        result: {
          imagePath: outputPath,
          prompt,
          negativePrompt,
          aspect_ratio: aspect_ratio ?? '1:1',
          modelUsed: modelId,
          seed: result.seeds?.[0]
        }
      }
    } catch (error: any) {
      if (error.name === 'ThrottlingException') {
        const alternativeModels = [
          'stability.sd3-large-v1:0',
          'stability.stable-image-core-v1:1',
          'stability.stable-image-ultra-v1:1'
        ].filter((m) => m !== modelId)

        throw `${JSON.stringify({
          success: false,
          error: 'Rate limit exceeded. Please try again with a different model.',
          suggestedModels: alternativeModels,
          message: error.message
        })}`
      }

      throw `${JSON.stringify({
        success: false,
        error: 'Failed to generate image',
        message: error.message
      })}`
    }
  }

  async retrieve(
    bedrock: BedrockService,
    toolInput: {
      knowledgeBaseId: string
      query: string
    }
  ): Promise<RetrieveResult> {
    const { knowledgeBaseId, query } = toolInput

    try {
      const result = await bedrock.retrieve({
        knowledgeBaseId,
        retrievalQuery: {
          text: query
        }
      })

      return {
        success: true,
        name: 'retrieve',
        message: `Retrieved information from knowledge base ${knowledgeBaseId}`,
        result
      }
    } catch (error: any) {
      throw `Error retrieve: ${JSON.stringify({
        success: false,
        name: 'retrieve',
        error: 'Failed to retrieve information from knowledge base',
        message: error.message
      })}`
    }
  }

  async invokeBedrockAgent(
    bedrock: BedrockService,
    projectPath: string,
    toolInput: {
      agentId: string
      agentAliasId: string
      sessionId?: string
      inputText: string
      file?: {
        filePath?: string
        useCase?: FileUseCase
      }
    }
  ): Promise<InvokeBedrockAgentResult> {
    const { agentId, agentAliasId, sessionId, inputText, file } = toolInput

    try {
      // ファイル処理の修正
      let fileData: any = undefined
      if (file && file.filePath) {
        const fileContent = await fs.readFile(file.filePath)
        const filename = path.basename(file.filePath)
        const mimeType = getMimeType(file.filePath)

        fileData = {
          files: [
            {
              name: filename,
              source: {
                sourceType: 'BYTE_CONTENT',
                byteContent: {
                  // CSVファイルの場合は text/csv を使用
                  mediaType: filename.endsWith('.csv') ? 'text/csv' : mimeType,
                  data: fileContent
                }
              },
              useCase: file.useCase
            }
          ]
        }
      }

      const command: InvokeAgentInput = {
        agentId,
        agentAliasId,
        sessionId,
        inputText,
        enableTrace: true,
        sessionState: fileData
      }

      const result = await bedrock.invokeAgent(command)
      const filePaths = result.completion?.files.map((file) => {
        const filePath = path.join(projectPath, file.name)
        fs.writeFile(filePath, file.content)
        return filePath
      })

      return {
        success: true,
        name: 'invokeBedrockAgent',
        message: `Invoked agent ${agentId} with alias ${agentAliasId}`,
        result: {
          ...result,
          completion: {
            ...result.completion,
            files: filePaths
          }
        }
      }
    } catch (error: any) {
      console.error('Error details:', error)
      throw `Error invoking agent: ${JSON.stringify({
        success: false,
        name: 'invokeBedrockAgent',
        error: 'Failed to invoke agent',
        message: error.message
      })}`
    }
  }

  async executeCommand(
    input: CommandInput | CommandStdinInput,
    config: CommandConfig
  ): Promise<ExecuteCommandResult> {
    try {
      const commandService = this.getCommandService(config)
      let result

      if ('stdin' in input && 'pid' in input) {
        // 標準入力を送信
        result = await commandService.sendInput(input)
      } else if ('command' in input && 'cwd' in input) {
        // 新しいコマンドを実行
        result = await commandService.executeCommand(input)
      } else {
        throw new Error('Invalid input format')
      }

      return {
        success: true,
        name: 'executeCommand',
        message: `Command executed: ${JSON.stringify(input)}`,
        ...result
      }
    } catch (error) {
      throw JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error occurred'
      })
    }
  }
}

function getMimeType(filePath) {
  const ext = path.extname(filePath).toLowerCase()
  const mimeTypes = {
    '.html': 'text/html',
    '.js': 'text/javascript',
    '.css': 'text/css',
    '.json': 'application/json',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.gif': 'image/gif',
    '.svg': 'image/svg+xml',
    '.wav': 'audio/wav',
    '.mp4': 'video/mp4',
    '.woff': 'application/font-woff',
    '.ttf': 'application/font-ttf',
    '.eot': 'application/vnd.ms-fontobject',
    '.otf': 'application/font-otf',
    '.wasm': 'application/wasm'
  }

  return mimeTypes[ext] || 'application/octet-stream'
}
