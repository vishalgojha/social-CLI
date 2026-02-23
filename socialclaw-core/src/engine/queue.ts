import { Queue } from 'bullmq';
import IORedis from 'ioredis';
import { env } from '../config/env';

interface QueueLike {
  add: Queue['add'];
  close?: () => Promise<void>;
}

let redisConnection: IORedis | null = null;
let workflowQueue: QueueLike | null = null;

export interface WorkflowJobInput {
  executionId: string;
  tenantId: string;
  clientId: string;
  workflowId: string;
  workflowVersion: number;
  triggerType: string;
  triggerPayload: Record<string, unknown>;
}

function createNoopQueue(): QueueLike {
  return {
    add: async (_name, _data, _opts) => ({ id: `noop-${Date.now()}` } as Awaited<ReturnType<Queue['add']>>)
  };
}

function getWorkflowQueue(): QueueLike {
  if (workflowQueue) return workflowQueue;

  if (env.NODE_ENV === 'test') {
    workflowQueue = createNoopQueue();
    return workflowQueue;
  }

  redisConnection = new IORedis(env.REDIS_URL, { maxRetriesPerRequest: null });
  workflowQueue = new Queue('workflow-execution', {
    connection: redisConnection,
    defaultJobOptions: {
      attempts: 5,
      backoff: { type: 'exponential', delay: 1000 },
      removeOnComplete: 500,
      removeOnFail: 1000
    }
  });
  return workflowQueue;
}

export async function enqueueWorkflowExecution(job: WorkflowJobInput): Promise<void> {
  const queue = getWorkflowQueue();
  await queue.add('execute-workflow', job, {
    jobId: `${job.executionId}`
  });
}

export async function closeWorkflowQueue(): Promise<void> {
  if (workflowQueue && workflowQueue.close) {
    await workflowQueue.close();
  }
  workflowQueue = null;

  if (redisConnection) {
    await redisConnection.quit();
  }
  redisConnection = null;
}
