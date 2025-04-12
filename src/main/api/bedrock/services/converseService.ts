import {
  ContentBlock,
  ConverseCommand,
  ConverseCommandInput,
  ConverseCommandOutput,
  ConverseStreamCommand,
  ConverseStreamCommandInput,
  ConverseStreamCommandOutput,
  InvokeModelCommand,
  Message
} from '@aws-sdk/client-bedrock-runtime'
import { createRuntimeClient } from '../client'
import { processImageContent } from '../utils/imageUtils'
import { getAlternateRegionOnThrottling } from '../utils/awsUtils'
import type { CallConverseAPIProps, ServiceContext } from '../types'
import { createCategoryLogger } from '../../../../common/logger'

// Create category logger for converse service
const converseLogger = createCategoryLogger('bedrock:converse')

/**
 * Bedrock Converse APIと連携するサービスクラス
 * リクエストの前処理やエラーハンドリングを担当
 */
export class ConverseService {
  private static readonly MAX_RETRIES = 30
  private static readonly RETRY_DELAY = 5000

  constructor(private context: ServiceContext) {}

  /**
   * 非ストリーミングのConverseAPIを呼び出す
   */
  async converse(props: CallConverseAPIProps, retries = 0): Promise<ConverseCommandOutput> {
    try {
      // リクエストパラメータの準備
      const { commandParams } = await this.prepareCommandParameters(props)
      const runtimeClient = createRuntimeClient(this.context.store.get('aws'))
      const awsConfig = this.context.store.get('aws')

      // APIリクエスト前にログ出力
      converseLogger.debug('Sending converse request', {
        modelId: props.modelId,
        region: awsConfig.region,
        messageCount: props.messages.length
      })

      // APIリクエストを送信
      const command = new ConverseCommand(commandParams)
      return await runtimeClient.send(command)
    } catch (error: any) {
      return this.handleError(error, props, retries, 'converse', ConverseCommand)
    }
  }

  /**
   * ストリーミング形式のConverseAPIを呼び出す
   */
  async converseStream(
    props: CallConverseAPIProps,
    retries = 0
  ): Promise<ConverseStreamCommandOutput> {
    try {
      // リクエストパラメータの準備
      const { commandParams } = await this.prepareCommandParameters(props)
      const runtimeClient = createRuntimeClient(this.context.store.get('aws'))
      const awsConfig = this.context.store.get('aws')

      // APIリクエスト前にログ出力
      converseLogger.debug('Sending stream converse request', {
        modelId: props.modelId,
        region: awsConfig.region,
        messageCount: props.messages.length
      })

      // APIリクエストを送信
      const command = new ConverseStreamCommand(commandParams)
      return await runtimeClient.send(command)
    } catch (error: any) {
      return this.handleError(error, props, retries, 'converseStream', ConverseStreamCommand)
    }
  }

  /**
   * APIリクエスト用のパラメータを準備
   * メッセージの処理とコマンドパラメータの作成を行う
   */
  private async prepareCommandParameters(props: CallConverseAPIProps): Promise<{
    commandParams: ConverseCommandInput | ConverseStreamCommandInput
    processedMessages?: Message[]
  }> {
    const { modelId, messages, system, toolConfig, guardrailConfig } = props

    // 画像データを含むメッセージを処理
    const processedMessages = this.processMessages(messages)

    // デバッグ用：空のテキストフィールドのチェック
    this.logEmptyTextFields(processedMessages)

    // メッセージを正規化
    const sanitizedMessages = this.normalizeMessages(processedMessages)

    // 推論パラメータを取得
    const inferenceParams = this.context.store.get('inferenceParams')

    const thinkingMode = this.context.store.get('thinkingMode')

    // Claude 3.7 Sonnet でThinking Modeが有効な場合、additionalModelRequestFieldsを追加
    let additionalModelRequestFields: Record<string, any> | undefined = undefined

    // thinkingモードが有効かつmodelIdがClaude 3.7 Sonnetの場合のみ設定
    if (modelId.includes('anthropic.claude-3-7-sonnet') && thinkingMode?.type === 'enabled') {
      additionalModelRequestFields = {
        thinking: {
          type: thinkingMode.type,
          budget_tokens: thinkingMode.budget_tokens
        }
      }
      inferenceParams.topP = undefined // reasoning は topP は不要
      inferenceParams.temperature = 1 // reasoning は temperature を 1 必須

      // Thinking Mode有効時の特別なログ出力
      converseLogger.debug('Enabling Thinking Mode', {
        modelId,
        thinkingType: thinkingMode.type,
        budgetTokens: thinkingMode.budget_tokens,
        messageCount: messages.length,
        assistantMessages: messages.filter((m) => m.role === 'assistant').length
      })
    }

    if (modelId.includes('nova')) {
      // https://docs.aws.amazon.com/nova/latest/userguide/tool-use-definition.html
      // For tool calling, the inference parameters should be set as inf_params = {"topP": 1, "temperature": 1} and additionalModelRequestFields= {"inferenceConfig": {"topK":1}}. This is because we encourage greedy decoding parameters for Amazon Nova tool calling.
      additionalModelRequestFields = {
        inferenceConfig: { topK: 1 }
      }
      inferenceParams.topP = 1
      inferenceParams.temperature = 1
    }

    // コマンドパラメータを作成
    const commandParams: ConverseCommandInput | ConverseStreamCommandInput = {
      modelId,
      messages: sanitizedMessages,
      system,
      toolConfig,
      inferenceConfig: inferenceParams,
      additionalModelRequestFields
    }

    // ガードレール設定が提供されている場合、または設定から有効になっている場合に追加
    if (guardrailConfig) {
      commandParams.guardrailConfig = guardrailConfig
      converseLogger.debug('Using provided guardrail', {
        guardrailId: guardrailConfig.guardrailIdentifier,
        guardrailVersion: guardrailConfig.guardrailVersion
      })
    } else {
      // 設定からガードレール設定を取得
      const storedGuardrailSettings = this.context.store.get('guardrailSettings')
      if (storedGuardrailSettings?.enabled && storedGuardrailSettings.guardrailIdentifier) {
        commandParams.guardrailConfig = {
          guardrailIdentifier: storedGuardrailSettings.guardrailIdentifier,
          guardrailVersion: storedGuardrailSettings.guardrailVersion,
          trace: storedGuardrailSettings.trace
        }
        converseLogger.debug('Using guardrail from settings', {
          guardrailId: storedGuardrailSettings.guardrailIdentifier,
          guardrailVersion: storedGuardrailSettings.guardrailVersion
        })
      }
    }

    return { commandParams, processedMessages }
  }

  /**
   * メッセージを処理し、画像データを正しい形式に変換
   */
  private processMessages(messages: Message[]): Message[] {
    return messages.map((msg) => ({
      ...msg,
      content: Array.isArray(msg.content) ? processImageContent(msg.content) : msg.content
    }))
  }

  /**
   * 空のテキストフィールドを持つメッセージをログに出力
   */
  private logEmptyTextFields(messages: Message[]): void {
    const emptyTextFieldMsgs = messages.filter(
      (msg) =>
        Array.isArray(msg.content) &&
        msg.content.some(
          (block) =>
            Object.prototype.hasOwnProperty.call(block, 'text') &&
            (!block.text || !block.text.trim())
        )
    )

    if (emptyTextFieldMsgs.length > 0) {
      converseLogger.debug('Found empty text fields in content blocks before sanitization', {
        emptyTextFieldMsgs: JSON.stringify(emptyTextFieldMsgs),
        count: emptyTextFieldMsgs.length
      })
    }
  }

  /**
   * コンテンツブロックのテキストフィールドが空でないことを確認
   */
  private sanitizeContentBlocks(content: ContentBlock[] | unknown): ContentBlock[] | undefined {
    if (!Array.isArray(content)) {
      return undefined
    }

    return content.map((block) => {
      // テキストフィールドが空または実質的に空（空白・改行のみ）の場合
      if (
        Object.prototype.hasOwnProperty.call(block, 'text') &&
        (block.text === '' || !block.text?.trim())
      ) {
        // スペース1文字をプレースホルダーとして設定
        block.text = ' '
      }

      // toolUseブロックの入力が空文字の場合、空のJSONオブジェクトに変換
      if (
        Object.prototype.hasOwnProperty.call(block, 'toolUse') &&
        block.toolUse &&
        Object.prototype.hasOwnProperty.call(block.toolUse, 'input') &&
        block.toolUse.input === ''
      ) {
        // 空の文字列を空のJSONオブジェクトに置き換える
        block.toolUse.input = {}
        converseLogger.debug(
          'Empty toolUse.input converted to empty JSON object in sanitizeContentBlocks',
          {
            toolName: block.toolUse.name
          }
        )
      }

      return block
    }) as ContentBlock[]
  }

  /**
   * メッセージの各コンテンツブロックを正規化
   */
  private normalizeMessages(messages: Message[]): Message[] {
    return messages.map((message) => {
      if (message.content) {
        // コンテンツが配列の場合、空のテキストブロックを除去してからサニタイズ
        if (Array.isArray(message.content)) {
          // 空のコンテンツブロックを持たないように配列をフィルタリング
          const validBlocks = message.content.filter((block) => {
            // テキストブロックで、かつ中身が実質的に空の場合はフィルタリング
            if (
              Object.prototype.hasOwnProperty.call(block, 'text') &&
              (!block.text || !block.text.trim())
            ) {
              // ツールの使用結果など他のブロックタイプがある場合は保持する
              return Object.keys(block).length > 1
            }
            return true
          })

          // toolUseブロックの入力が空文字の場合、空のJSONオブジェクトに変換
          validBlocks.forEach((block) => {
            if (
              Object.prototype.hasOwnProperty.call(block, 'toolUse') &&
              block.toolUse &&
              Object.prototype.hasOwnProperty.call(block.toolUse, 'input') &&
              block.toolUse.input === ''
            ) {
              // 空の文字列を空のJSONオブジェクトに置き換える
              block.toolUse.input = {}
              converseLogger.debug('Empty toolUse.input converted to empty JSON object', {
                toolName: block.toolUse.name
              })
            }
          })

          // 配列が空になってしまった場合は、最低1つの有効なブロックを確保
          if (validBlocks.length === 0) {
            message.content = [{ text: ' ' }]
          } else {
            // 残ったブロックをサニタイズ
            message.content = this.sanitizeContentBlocks(validBlocks)
          }
        } else {
          message.content = this.sanitizeContentBlocks(message.content)
        }
      }
      return message
    })
  }

  /**
   * エラー処理を行う
   */
  private async handleError<T extends ConverseCommandOutput | ConverseStreamCommandOutput>(
    error: any,
    props: CallConverseAPIProps,
    retries: number,
    methodName: 'converse' | 'converseStream',
    CommandClass: typeof ConverseCommand | typeof ConverseStreamCommand
  ): Promise<T> {
    // スロットリングまたはサービス利用不可の場合
    if (error.name === 'ThrottlingException' || error.name === 'ServiceUnavailableException') {
      converseLogger.warn(`${error.name} occurred - retrying`, {
        retry: retries,
        errorName: error.name,
        message: error.message,
        modelId: props.modelId,
        method: methodName
      })

      // 最大リトライ回数を超えた場合はエラーをスロー
      if (retries >= ConverseService.MAX_RETRIES) {
        converseLogger.error('Maximum retries reached for Bedrock API request', {
          maxRetries: ConverseService.MAX_RETRIES,
          errorName: error.name,
          modelId: props.modelId,
          method: methodName
        })
        throw error
      }

      // スロットリングの場合は別リージョンでの実行を試みる
      if (error.name === 'ThrottlingException') {
        const alternateResult = await this.tryAlternateRegion(props, error, CommandClass)
        if (alternateResult) {
          return alternateResult as T
        }
      }

      // 待機してから再試行
      await new Promise((resolve) => setTimeout(resolve, ConverseService.RETRY_DELAY))
      return methodName === 'converse'
        ? ((await this.converse(props, retries + 1)) as T)
        : ((await this.converseStream(props, retries + 1)) as T)
    }

    // バリデーションエラーの場合
    if (error.name === 'ValidationException') {
      // その他のバリデーションエラー
      converseLogger.error(`ValidationException in ${methodName}`, {
        errorMessage: error.message,
        errorDetails: error.$metadata,
        modelId: props.modelId
      })
    } else {
      // その他のエラー
      converseLogger.error(`Error in ${methodName}`, {
        errorName: error.name,
        errorMessage: error.message,
        modelId: props.modelId,
        stack: error.stack
      })
    }

    throw error
  }

  /**
   * 画像認識を実行する
   */
  async recognizeImage(props: {
    imagePath: string
    prompt?: string
    modelId?: string
  }): Promise<string> {
    const {
      imagePath,
      prompt = 'Please explain in detail what this image is about.',
      modelId = 'anthropic.claude-3-sonnet-20240229-v1:0'
    } = props

    converseLogger.debug('Recognizing image', {
      imagePath,
      modelId,
      hasCustomPrompt: !!prompt
    })

    try {
      // Node.jsの組み込みモジュール
      const fs = require('fs')
      const path = require('path')

      // ファイル存在確認
      if (!fs.existsSync(imagePath)) {
        throw new Error(`Image file not found: ${imagePath}`)
      }

      // 画像形式の確認
      const ext = path.extname(imagePath).toLowerCase()
      const supportedFormats = ['.jpg', '.jpeg', '.png', '.gif', '.webp']

      if (!supportedFormats.includes(ext)) {
        throw new Error(`Unsupported image format: ${ext}`)
      }

      // ファイルサイズの確認
      const stats = fs.statSync(imagePath)
      const maxSize = 3.75 * 1024 * 1024 // 3.75MB

      if (stats.size > maxSize) {
        throw new Error(`Image file too large: ${stats.size} bytes (max: ${maxSize} bytes)`)
      }

      // 画像をBase64エンコード
      const fileContent = fs.readFileSync(imagePath)
      const base64Data = Buffer.from(fileContent).toString('base64')

      // メディアタイプの取得
      const mimeTypes = {
        '.jpg': 'image/jpeg',
        '.jpeg': 'image/jpeg',
        '.png': 'image/png',
        '.gif': 'image/gif',
        '.webp': 'image/webp'
      }
      const mediaType = mimeTypes[ext] || 'application/octet-stream'

      // InvokeModelを直接呼び出す方がシンプル
      const runtimeClient = createRuntimeClient(this.context.store.get('aws'))

      // Claude Messages APIのリクエスト形式を構築
      const requestBody = {
        anthropic_version: 'bedrock-2023-05-31',
        max_tokens: 4096,
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'image',
                source: {
                  type: 'base64',
                  media_type: mediaType,
                  data: base64Data
                }
              },
              {
                type: 'text',
                text: prompt
              }
            ]
          }
        ],
        system:
          'あなたは画像認識を行うアシスタントです。提供された画像を詳細に分析し、説明してください。'
      }

      converseLogger.info('Calling Bedrock for image recognition', {
        imagePath: path.basename(imagePath),
        modelId
      })

      // InvokeModelCommand を使用して直接モデル呼び出し
      const command = new InvokeModelCommand({
        modelId,
        contentType: 'application/json',
        accept: 'application/json',
        body: JSON.stringify(requestBody)
      })

      // リクエスト実行
      const response = await runtimeClient.send(command)

      // レスポンスをパース
      const responseBody = new TextDecoder().decode(response.body)
      const result = JSON.parse(responseBody)

      // レスポンスからテキスト部分を抽出
      let description = ''
      if (result.content) {
        if (Array.isArray(result.content)) {
          // コンテンツが配列の場合はテキスト部分を連結
          description = result.content
            .filter((item) => item.type === 'text')
            .map((item) => item.text)
            .join('\n')
        } else if (typeof result.content === 'string') {
          // 文字列の場合はそのまま使用
          description = result.content
        }
      }

      if (!description) {
        throw new Error('No text content in response')
      }

      converseLogger.info('Image recognition successful', {
        imagePath: path.basename(imagePath),
        modelId,
        responseLength: description.length
      })

      return description
    } catch (error: any) {
      converseLogger.error('Error in image recognition', {
        imagePath,
        error: error instanceof Error ? error.message : String(error),
        modelId
      })

      throw error
    }
  }

  /**
   * 別リージョンでのAPIコール実行を試みる
   */
  private async tryAlternateRegion<T extends ConverseCommandOutput | ConverseStreamCommandOutput>(
    props: CallConverseAPIProps,
    _error: any,
    CommandClass: typeof ConverseCommand | typeof ConverseStreamCommand
  ): Promise<T | null> {
    const awsConfig = this.context.store.get('aws')
    const bedrockSettings = this.context.store.get('bedrockSettings')

    if (!bedrockSettings?.enableRegionFailover) {
      return null
    }

    const availableRegions = bedrockSettings.availableFailoverRegions || []
    const alternateRegion = getAlternateRegionOnThrottling(
      awsConfig.region,
      props.modelId,
      availableRegions
    )

    // 別のリージョンが現在のリージョンと同じ場合はスキップ
    if (alternateRegion === awsConfig.region) {
      return null
    }

    converseLogger.info('Switching to alternate region due to throttling', {
      currentRegion: awsConfig.region,
      alternateRegion,
      modelId: props.modelId
    })

    try {
      // 別リージョン用のクライアントを作成
      const alternateClient = createRuntimeClient({
        ...awsConfig,
        region: alternateRegion
      })

      // リクエストパラメータを再作成
      const { commandParams } = await this.prepareCommandParameters(props)

      // コマンドクラスに応じて適切なインスタンスを作成
      if (CommandClass === ConverseCommand) {
        const command = new ConverseCommand(commandParams)
        return (await alternateClient.send(command)) as T
      } else {
        const command = new ConverseStreamCommand(commandParams)
        return (await alternateClient.send(command)) as T
      }
    } catch (alternateError: any) {
      converseLogger.error('Error in alternate region request', {
        region: alternateRegion,
        modelId: props.modelId,
        errorName: alternateError?.name,
        errorMessage: alternateError?.message,
        stack: alternateError?.stack
      })
      return null // 別リージョンでもエラーの場合は null を返し、通常の再試行へ
    }
  }
}
