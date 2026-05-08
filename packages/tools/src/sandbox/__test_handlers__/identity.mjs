import { threadId } from 'node:worker_threads'

export default async function identity() {
	return {
		pid: process.pid,
		threadId,
		isMainThread: threadId === 0,
	}
}
