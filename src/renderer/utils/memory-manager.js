/**
 * Memory Manager
 * Handles conversation history, summarization, and context optimization
 */

// Gate verbose logs in test environment
const DEBUG = typeof process !== 'undefined' && process.env?.NODE_ENV !== 'test';

class MemoryManager {
  constructor(historyLimit = 10) {
    this.messages = []              // Full conversation history
    this.summary = null              // Current conversation summary
    this.historyLimit = historyLimit // Number of recent messages to keep in context
    this.bufferZone = 5              // Extra messages before triggering summarization
    this.summarizationThreshold = historyLimit + this.bufferZone // Dynamic threshold
    this.summaryVersion = 0          // Track re-summarizations
    this.pendingSummaryTarget = null // Message boundary currently being summarized
    this.failedSummaryTarget = null  // Last failed boundary, to avoid identical retries
  }

  /**
   * Add a message to the conversation history
   * @param {string} role - 'user' or 'assistant'
   * @param {string} content - Message content
   */
  addMessage(role, content) {
    this.messages.push({
      role,
      content,
      timestamp: Date.now()
    })

    // Check if we need to generate a summary
    this.checkSummarizationNeeded()
  }

  /**
   * Check if summarization should be triggered
   */
  checkSummarizationNeeded() {
    // Only summarize if we have more messages than threshold and no summary yet
    if (this.messages.length > this.summarizationThreshold && !this.summary) {
      if (DEBUG) {
        console.log('Summarization needed:', {
          messageCount: this.messages.length,
          threshold: this.summarizationThreshold
        })
      }
      // Note: Actual summarization is triggered externally via generateSummary()
      // This just logs that it's needed
    }
  }

  /**
   * Get the message boundary for the next summary
   * @returns {number}
   */
  getSummaryTargetMessageCount() {
    const recentMessageLimit = this.summary
      ? Math.max(0, this.historyLimit - this.bufferZone)
      : this.historyLimit
    return Math.max(0, this.messages.length - recentMessageLimit)
  }

  /**
   * Generate a summary of old messages
   * @param {Function} summaryGenerator - Async function that generates summary from messages
   * @param {Function} isCurrent - Lifecycle check used before committing async results
   */
  async generateSummary(summaryGenerator, isCurrent = () => true) {
    if (!this.summary && this.messages.length <= this.historyLimit) {
      if (DEBUG) console.log('Not enough messages to summarize')
      return false
    }

    const targetMessageCount = this.getSummaryTargetMessageCount()
    const coveredMessageCount = this.summary
      ? (this.summary.coveredMessageCount ?? this.summary.messageCount)
      : 0

    if (targetMessageCount <= coveredMessageCount || this.pendingSummaryTarget === targetMessageCount || this.failedSummaryTarget === targetMessageCount) {
      return false
    }

    // Initial summaries cover the messages outside the recent window. Later
    // summaries include a buffer of recent messages so coverage can advance in
    // batches instead of requiring a summary on every send.
    const messagesToSummarize = this.messages.slice(0, targetMessageCount)
    const messageCountAtStart = this.messages.length

    if (messagesToSummarize.length === 0) {
      if (DEBUG) console.log('No messages to summarize')
      return false
    }

    this.pendingSummaryTarget = targetMessageCount

    try {
      if (DEBUG) console.log('Generating summary for', messagesToSummarize.length, 'messages')

      if (!isCurrent()) return false
      
      // Call the summary generator (passed from app.js)
      const summaryText = await summaryGenerator(messagesToSummarize)

      if (!isCurrent()) return false

      this.summary = {
        text: summaryText,
        generatedAt: Date.now(),
        messageCount: messagesToSummarize.length,
        coveredMessageCount: targetMessageCount,
        sourceMessageCount: messageCountAtStart,
        version: ++this.summaryVersion
      }
      this.failedSummaryTarget = null

      if (DEBUG) {
        console.log('Summary generated:', {
          length: summaryText.length,
          messageCount: this.summary.messageCount,
          coveredMessageCount: this.summary.coveredMessageCount,
          version: this.summary.version
        })
      }
      return true
    } catch (error) {
      this.failedSummaryTarget = targetMessageCount
      console.error('Failed to generate summary:', error)
      throw error
    } finally {
      if (this.pendingSummaryTarget === targetMessageCount) {
        this.pendingSummaryTarget = null
      }
    }
  }

  /**
   * Get context for the next LLM request
   * Returns summary (if exists) + recent messages
   * @returns {Object} { summary: string|null, messages: Array }
   */
  getContextForRequest() {
    const coveredMessageCount = this.summary
      ? (this.summary.coveredMessageCount ?? this.summary.messageCount)
      : 0
    const lastHistoryStart = Math.max(0, this.messages.length - this.historyLimit)
    const preserveUncoveredMessages = this.pendingSummaryTarget !== null || this.failedSummaryTarget !== null
    const recentStart = this.summary
      ? Math.min(lastHistoryStart, coveredMessageCount)
      : this.messages.length <= this.summarizationThreshold || preserveUncoveredMessages
        ? 0
        : lastHistoryStart

    return {
      summary: this.summary ? this.summary.text : null,
      messages: this.messages.slice(recentStart)
    }
  }

  /**
   * Update the history limit
   * @param {number} newLimit
   */
  updateHistoryLimit(newLimit) {
    this.historyLimit = newLimit
    this.summarizationThreshold = newLimit + this.bufferZone
    this.failedSummaryTarget = null
    if (DEBUG) console.log('History limit updated to:', newLimit, '(threshold:', this.summarizationThreshold + ')')
  }

  /**
   * Clear all conversation history and summary
   */
  clearConversation() {
    this.messages = []
    this.summary = null
    this.summaryVersion = 0
    this.pendingSummaryTarget = null
    this.failedSummaryTarget = null
    if (DEBUG) console.log('Conversation cleared')
  }

  /**
   * Get current state for debugging
   * @returns {Object}
   */
  getState() {
    return {
      totalMessages: this.messages.length,
      historyLimit: this.historyLimit,
      hasSummary: !!this.summary,
      summaryVersion: this.summaryVersion,
      summaryCoveredMessageCount: this.summary ? (this.summary.coveredMessageCount ?? this.summary.messageCount) : 0,
      summarizationThreshold: this.summarizationThreshold
    }
  }

  /**
   * Check if summarization should be triggered now
   * @returns {boolean}
   */
  shouldGenerateSummary() {
    if (this.messages.length <= this.summarizationThreshold || this.summary || this.pendingSummaryTarget !== null) {
      return false
    }

    return this.failedSummaryTarget !== this.getSummaryTargetMessageCount()
  }

  /**
   * Check if re-summarization is needed (for very long conversations)
   * @returns {boolean}
   */
  shouldRegenerateSummary() {
    if (!this.summary || this.pendingSummaryTarget !== null) return false

    const coveredMessageCount = this.summary.coveredMessageCount ?? this.summary.messageCount
    if (this.messages.length - coveredMessageCount <= this.historyLimit) {
      return false
    }

    const targetMessageCount = this.getSummaryTargetMessageCount()
    return targetMessageCount > coveredMessageCount && this.failedSummaryTarget !== targetMessageCount
  }
}

export default MemoryManager
