import React, { useMemo, useState, useEffect, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { Label, Select, Button } from 'flowbite-react'
import { ArrowPathIcon } from '@heroicons/react/24/outline'
import { useSettings } from '@renderer/contexts/SettingsContext'
import { CameraConfig } from '@/types/agent-chat'
import { CameraDeviceInfo, enumerateCameraDevices } from '@renderer/lib/camera-utils'

// カメラデバイス情報の型定義（既存のCameraConfigと互換性を保つ）
interface CameraInfo extends CameraDeviceInfo {
  thumbnail?: string // base64画像データ（オプショナル）
}

export const CameraCaptureSettingForm: React.FC = () => {
  const { t } = useTranslation()
  const {
    recognizeImageModel,
    setRecognizeImageModel,
    availableModels,
    selectedAgentId,
    getAgentAllowedCameras,
    updateAgentAllowedCameras
  } = useSettings()

  // カメラ関連の状態
  const [availableCameras, setAvailableCameras] = useState<CameraInfo[]>([])
  const [allowedCameras, setAllowedCameras] = useState<CameraConfig[]>([])
  const [isLoadingCameras, setIsLoadingCameras] = useState(false)
  const [imageLoadErrors, setImageLoadErrors] = useState<Set<string>>(new Set())

  // Vision-capable モデルをフィルタリング（Claude と Nova シリーズ）
  const visionCapableModels = useMemo(() => {
    return availableModels
      .filter(
        (model) =>
          model.modelId.includes('anthropic.claude') || model.modelId.includes('amazon.nova')
      )
      .sort((a, b) => a.modelName.localeCompare(b.modelName))
  }, [availableModels])

  // エージェントの許可カメラ設定を読み込み
  useEffect(() => {
    if (selectedAgentId) {
      const cameras = getAgentAllowedCameras(selectedAgentId)
      setAllowedCameras(cameras)
    }
  }, [selectedAgentId, getAgentAllowedCameras])

  // 画像読み込みエラーハンドラー（React状態ベース）
  const handleImageError = useCallback((cameraId: string) => {
    setImageLoadErrors((prev) => new Set([...prev, cameraId]))
  }, [])

  // 利用可能なカメラ一覧を取得
  const fetchAvailableCameras = useCallback(async () => {
    setIsLoadingCameras(true)
    setImageLoadErrors(new Set()) // エラー状態をリセット
    try {
      const cameras = await enumerateCameraDevices()
      setAvailableCameras(cameras)
    } catch (error) {
      console.error('Failed to fetch available cameras:', error)
      setAvailableCameras([])
    } finally {
      setIsLoadingCameras(false)
    }
  }, [])

  // カメラが許可されているかチェック
  const isCameraAllowed = (camera: CameraInfo): boolean => {
    return allowedCameras.some((allowed) => allowed.id === camera.id)
  }

  // カメラの許可/非許可を切り替え
  const handleCameraToggle = (camera: CameraInfo, enabled: boolean) => {
    if (!selectedAgentId) return

    let updatedCameras: CameraConfig[]

    if (enabled) {
      // カメラを許可リストに追加
      const newCamera: CameraConfig = {
        id: camera.id,
        name: camera.name,
        enabled: true
      }
      updatedCameras = [...allowedCameras.filter((c) => c.id !== camera.id), newCamera]
    } else {
      // カメラを許可リストから削除
      updatedCameras = allowedCameras.filter((c) => c.id !== camera.id)
    }

    setAllowedCameras(updatedCameras)
    updateAgentAllowedCameras(selectedAgentId, updatedCameras)
  }

  // 初回読み込み時にカメラ一覧を取得
  useEffect(() => {
    fetchAvailableCameras()
  }, [])

  return (
    <div className="prose dark:prose-invert max-w-none w-full">
      {/* ツールの説明 */}
      <div className="mb-6 w-full">
        <p className="mb-4 text-gray-700 dark:text-gray-300">
          {t(
            'tool info.cameraCapture.description',
            'The cameraCapture tool captures images from PC camera and saves them as image files. When a recognition prompt is provided, the captured image will be automatically analyzed with AI to extract text content, identify objects, and provide detailed visual descriptions for analysis and documentation purposes.'
          )}
        </p>
      </div>

      {/* 設定フォーム */}
      <div className="flex flex-col gap-4 p-4 border border-gray-200 dark:border-gray-700 rounded-md mb-6 w-full">
        <h4 className="font-medium text-sm mb-2 dark:text-gray-200">
          {t('AI Image Analysis Settings')}
        </h4>

        {/* LLMモデル選択 */}
        <div className="w-full">
          <Label htmlFor="cameraCaptureModel" value={t('AI Model for Image Analysis')} />
          <Select
            id="cameraCaptureModel"
            value={recognizeImageModel}
            onChange={(e) => setRecognizeImageModel(e.target.value)}
            className="mt-2 w-full"
          >
            {visionCapableModels.map((model) => (
              <option key={model.modelId} value={model.modelId}>
                {model.modelName}
              </option>
            ))}
          </Select>
        </div>

        {/* カメラ品質設定 */}
        <div className="w-full">
          <Label htmlFor="cameraQuality" value={t('Image Quality')} />
          <Select id="cameraQuality" className="mt-2 w-full" defaultValue="medium">
            <option value="low">{t('Low (640x480)')}</option>
            <option value="medium">{t('Medium (1280x720)')}</option>
            <option value="high">{t('High (1920x1080)')}</option>
          </Select>
        </div>

        {/* 使用方法 */}
        <div className="mt-4 p-3 bg-blue-50 dark:bg-blue-900/20 dark:border dark:border-blue-700 rounded-md">
          <h5 className="font-medium mb-2 dark:text-blue-300">{t('How to Use')}</h5>
          <ul className="text-sm text-gray-700 dark:text-gray-200 space-y-1">
            <li>
              • <strong>{t('Camera capture only')}:</strong>{' '}
              {t('Use without any prompt to capture camera image only')}
            </li>
            <li>
              • <strong>{t('Camera capture + AI analysis')}:</strong>{' '}
              {t('Provide a recognition prompt to automatically analyze the captured image')}
            </li>
            <li>
              • <strong>{t('Example prompts')}:</strong>{' '}
              {t(
                '"Describe what you see in this image", "Read any text in this photo", "Identify objects in the camera view"'
              )}
            </li>
          </ul>
        </div>

        {/* プラットフォーム要件 */}
        <div className="mt-4 p-3 bg-green-50 dark:bg-green-900/20 dark:border dark:border-green-700 rounded-md">
          <h5 className="font-medium mb-2 dark:text-green-300">{t('Platform Requirements')}</h5>
          <ul className="text-sm text-gray-700 dark:text-gray-200 space-y-1">
            <li>
              • <strong>macOS:</strong>{' '}
              {t(
                'Camera access permission required in System Preferences > Security & Privacy > Privacy > Camera'
              )}
            </li>
            <li>
              • <strong>Windows:</strong>{' '}
              {t('Camera access permission required in Windows Settings > Privacy > Camera')}
            </li>
          </ul>
        </div>
      </div>

      {/* カメラアクセス許可設定 */}
      <div className="flex flex-col gap-4 p-4 border border-gray-200 dark:border-gray-700 rounded-md mb-6 w-full">
        <div className="flex items-center justify-between">
          <h4 className="font-medium text-sm mb-2 dark:text-gray-200">
            {t('Camera Access Permissions')}
          </h4>
          <Button
            size="sm"
            color="light"
            onClick={fetchAvailableCameras}
            disabled={isLoadingCameras}
            className="flex items-center gap-2"
          >
            <ArrowPathIcon className={`w-4 h-4 ${isLoadingCameras ? 'animate-spin' : ''}`} />
            {t('Refresh')}
          </Button>
        </div>

        <p className="text-sm text-gray-600 dark:text-gray-400">
          {t(
            'Select which cameras this agent is allowed to access for image capture. Only selected cameras can be used for photography.'
          )}
        </p>

        {/* カメラプレビューグリッド */}
        {isLoadingCameras ? (
          <div className="flex items-center justify-center py-8">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-gray-900 dark:border-gray-100"></div>
            <span className="ml-3 text-gray-600 dark:text-gray-300">
              {t('Loading camera devices...')}
            </span>
          </div>
        ) : availableCameras.length === 0 ? (
          <div className="text-center py-8 text-gray-500 dark:text-gray-400">
            <div className="text-4xl mb-2">📷</div>
            <p>{t('No cameras available. Click refresh to try again.')}</p>
          </div>
        ) : (
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4 max-h-96 overflow-y-auto p-2">
            {availableCameras.map((camera) => {
              const isSelected = isCameraAllowed(camera)
              const hasImageError = imageLoadErrors.has(camera.id)

              return (
                <div
                  key={camera.id}
                  className={`
                    relative cursor-pointer transition-all duration-200 transform hover:scale-105
                    ${
                      isSelected
                        ? 'ring-2 ring-blue-500 dark:ring-blue-400 shadow-lg'
                        : 'ring-1 ring-gray-200 dark:ring-gray-600 hover:ring-gray-300 dark:hover:ring-gray-500'
                    }
                    rounded-lg overflow-hidden bg-white dark:bg-gray-800
                  `}
                  onClick={() => handleCameraToggle(camera, !isSelected)}
                >
                  {/* カメラプレビュー */}
                  <div className="relative aspect-video bg-gray-100 dark:bg-gray-700">
                    {hasImageError ? (
                      // React状態ベースのフォールバックUI
                      <div className="flex items-center justify-center h-full text-gray-400 dark:text-gray-500">
                        <div className="text-center">
                          <div className="text-2xl mb-1">📷</div>
                          <div className="text-xs">Preview not available</div>
                        </div>
                      </div>
                    ) : camera.thumbnail ? (
                      <img
                        src={camera.thumbnail}
                        alt={`Preview of ${camera.name}`}
                        className="w-full h-full object-cover"
                        onError={() => handleImageError(camera.id)}
                      />
                    ) : (
                      <div className="flex items-center justify-center h-full text-gray-400 dark:text-gray-500">
                        <div className="text-center">
                          <div className="text-2xl mb-1">📹</div>
                          <div className="text-xs">Live Preview</div>
                        </div>
                      </div>
                    )}

                    {/* 選択状態のオーバーレイ */}
                    {isSelected && (
                      <div className="absolute inset-0 bg-blue-500/20 dark:bg-blue-400/20 flex items-center justify-center">
                        <div className="bg-blue-500 dark:bg-blue-400 text-white rounded-full p-1">
                          <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                            <path
                              fillRule="evenodd"
                              d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                              clipRule="evenodd"
                            />
                          </svg>
                        </div>
                      </div>
                    )}

                    {/* カメラ解像度情報 */}
                    <div className="absolute top-1 right-1 bg-black/50 text-white text-xs px-1 py-0.5 rounded">
                      {camera.capabilities.maxWidth}×{camera.capabilities.maxHeight}
                    </div>
                  </div>

                  {/* カメラ情報 */}
                  <div className="p-3">
                    <div className="font-medium text-sm text-gray-900 dark:text-gray-100 truncate">
                      {camera.name}
                    </div>
                    <div className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                      {camera.capabilities.supportedFormats.join(', ')}
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        )}

        {/* 許可されたカメラの数 */}
        {allowedCameras.length > 0 && (
          <div className="text-sm text-green-600 dark:text-green-400">
            {t('{{count}} camera(s) allowed', { count: allowedCameras.length })}
          </div>
        )}

        {/* ヒント */}
        <div className="mt-4 p-3 bg-yellow-50 dark:bg-yellow-900/20 dark:border dark:border-yellow-700 rounded-md">
          <h5 className="font-medium mb-2 dark:text-yellow-300">{t('Usage Tips')}</h5>
          <ul className="text-sm text-gray-700 dark:text-gray-200 space-y-1">
            <li>• {t('If no cameras are selected, the agent can use the default camera')}</li>
            <li>• {t('Camera permissions are checked each time before capture')}</li>
            <li>• {t('Use the refresh button to update the list of available cameras')}</li>
            <li>• {t('Live preview may not be available for all camera devices')}</li>
          </ul>
        </div>
      </div>
    </div>
  )
}
