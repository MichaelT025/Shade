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
   * Generate a summary of old messages
   * @param {Function} summaryGenerator - Async function that generates summary from messages
   */
  async generateSummary(summaryGenerator) {
    if (this.messages.length <= this.historyLimit) {
      if (DEBUG) console.log('Not enough messages to summarize')
      return
    }

    // Get messages that will be summarized (all except last N)
    const messagesToSummarize = this.messages.slice(0, -this.historyLimit)

    if (messagesToSummarize.length === 0) {
      if (DEBUG) console.log('No messages to summarize')
      return
    }

    try {
      if (DEBUG) console.log('Generating summary for', messagesToSummarize.length, 'messages')
      
      // Call the summary generator (passed from app.js)
      const summaryText = await summaryGenerator(messagesToSummarize)

      this.summary = {
        text: summaryText,
        generatedAt: Date.now(),
        messageCount: messagesToSummarize.length,
        version: ++this.summaryVersion
      }

      if (DEBUG) {
        console.log('Summary generated:', {
          length: summaryText.length,
          messageCount: this.summary.messageCount,
          version: this.summary.version
        })
      }
    } catch (error) {
      console.error('Failed to generate summary:', error)
      throw error
    }
  }

  /**
   * Get context for the next LLM request
   * Returns summary (if exists) + recent messages
   * @returns {Object} { summary: string|null, messages: Array }
   */
  getContextForRequest() {
    if (this.messages.length <= this.historyLimit) {
      // Send all messages if under limit
      return {
        summary: null,
        messages: this.messages
      }
    }

    // Send summary + last N messages
    return {
      summary: this.summary ? this.summary.text : null,
      messages: this.messages.slice(-this.historyLimit)
    }
  }

  /**
   * Update the history limit
   * @param {number} newLimit
   */
  updateHistoryLimit(newLimit) {
    this.historyLimit = newLimit
    this.summarizationThreshold = newLimit + this.bufferZone
    if (DEBUG) console.log('History limit updated to:', newLimit, '(threshold:', this.summarizationThreshold + ')')
  }

  /**
   * Clear all conversation history and summary
   */
  clearConversation() {
    this.messages = []
    this.summary = null
    this.summaryVersion = 0
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
      summarizationThreshold: this.summarizationThreshold
    }
  }

  /**
   * Check if summarization should be triggered now
   * @returns {boolean}
   */
  shouldGenerateSummary() {
    return this.messages.length > this.summarizationThreshold && !this.summary
  }

  /**
   * Check if re-summarization is needed (for very long conversations)
   * @returns {boolean}
   */
  shouldRegenerateSummary() {
    if (!this.summary) return false
    
    // Re-summarize every 10 messages after initial summary
    const messagesSinceSummary = this.messages.length - this.summary.messageCount
    return messagesSinceSummary >= 10
  }
}

export default MemoryManager
