import { BedrockRuntimeClient } from '@aws-sdk/client-bedrock-runtime'
import { BedrockClient } from '@aws-sdk/client-bedrock'
import { BedrockAgentRuntimeClient } from '@aws-sdk/client-bedrock-agent-runtime'
import { fromIni } from '@aws-sdk/credential-providers'
import { NovaSonicBidirectionalStreamClient } from '../sonic/client'
import type { AWSCredentials } from './types'

export function createRuntimeClient(awsCredentials: AWSCredentials) {
  const { region, useProfile, profile, ...credentials } = awsCredentials
  if (useProfile) {
    return new BedrockRuntimeClient({
      region,
      profile
    })
  }

  return new BedrockRuntimeClient({
    region,
    credentials
  })
}

export function createBedrockClient(awsCredentials: AWSCredentials) {
  const { region, useProfile, profile, ...credentials } = awsCredentials

  if (useProfile) {
    return new BedrockClient({
      region,
      profile
    })
  }

  return new BedrockClient({
    region,
    credentials
  })
}

export function createAgentRuntimeClient(awsCredentials: AWSCredentials) {
  const { region, useProfile, profile, ...credentials } = awsCredentials

  if (useProfile) {
    return new BedrockAgentRuntimeClient({
      region,
      profile
    })
  }

  return new BedrockAgentRuntimeClient({
    region,
    credentials
  })
}

export function createNovaSonicClient(awsCredentials: AWSCredentials) {
  const { region, useProfile, profile, ...credentials } = awsCredentials

  const clientConfig = useProfile
    ? { region, credentials: fromIni({ profile }) }
    : { region, credentials }

  return new NovaSonicBidirectionalStreamClient({
    requestHandlerConfig: {
      maxConcurrentStreams: 10
    },
    clientConfig
  })
}
