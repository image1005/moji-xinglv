import { recoverInterruptedRuns } from '../services/chat-runs'

export default defineNitroPlugin(() => {
  recoverInterruptedRuns()
})
