export interface SubtitleEntry {
  original: string
  translation: string
  time: Date
  isFinal: boolean
}

export class LiveSubtitleManager {
  private maxLines = 3
  private history: SubtitleEntry[] = []
  private showOriginal = true
  private displayMode: "both" | "original" | "translation" = "both"

  // Callbacks
  onSubtitleUpdate: (data: { original: string, translation: string, entries: { original: string, translation: string }[] }) => void = () => {}

  constructor({ maxLines, showOriginal }: { maxLines?: number, showOriginal?: boolean } = {}) {
    if (maxLines !== undefined)
      this.maxLines = maxLines
    if (showOriginal !== undefined)
      this.showOriginal = showOriginal
  }

  setDisplayMode(mode: "both" | "original" | "translation") {
    this.displayMode = mode
    this._trimHistory()
    this._notify()
  }

  setMaxLines(n: number) {
    this.maxLines = Math.max(1, Math.min(10, n))
    this._trimHistory()
    this._notify()
  }

  setShowOriginal(show: boolean) {
    this.showOriginal = show
    this._notify()
  }

  addChunk({ original, translation, isFinal }: { original: string, translation: string, isFinal: boolean }) {
    if (this.history.length === 0) {
      this.history.push({
        original: original || "",
        translation: translation || "",
        time: new Date(),
        isFinal,
      })
      this._notify()
      return
    }

    const last = this.history[this.history.length - 1]

    if (last.isFinal) {
      if (!original && !translation)
        return
      this.history.push({
        original: original || "",
        translation: translation || "",
        time: new Date(),
        isFinal,
      })
    }
    else {
      // Accumulate increment
      last.original += original || ""
      last.translation += translation || ""
      last.isFinal = isFinal

      // Smart segmentation: if translation exceeds threshold and we hit punctuation, split
      const maxLen = 25
      if (last.translation.length > maxLen) {
        const punctuationMatch = last.translation.substring(maxLen).match(/[。！？.!?，,]/)
        if (punctuationMatch && punctuationMatch.index !== undefined) {
          const splitIdx = maxLen + punctuationMatch.index + 1
          const leftTranslation = last.translation.substring(0, splitIdx)
          const rightTranslation = last.translation.substring(splitIdx)

          let leftOriginal = last.original
          let rightOriginal = ""
          if (last.original.length > 0) {
            const splitRatio = splitIdx / last.translation.length
            const originalEstIdx = Math.floor(splitRatio * last.original.length)
            const origPunctuationMatch = last.original.substring(originalEstIdx).match(/[。！？.!?，, ]/)
            if (origPunctuationMatch && origPunctuationMatch.index !== undefined) {
              const origSplitIdx = originalEstIdx + origPunctuationMatch.index + 1
              leftOriginal = last.original.substring(0, origSplitIdx)
              rightOriginal = last.original.substring(origSplitIdx)
            }
          }

          // Finalize current entry, start a new one
          last.translation = leftTranslation
          last.original = leftOriginal
          last.isFinal = true

          if (rightTranslation.trim() || rightOriginal.trim()) {
            this.history.push({
              original: rightOriginal,
              translation: rightTranslation,
              time: new Date(),
              isFinal,
            })
          }
        }
      }

      // Force segment if text is too long (prevent UI overflow)
      if (last.translation.length > 100 || last.original.length > 200) {
        last.isFinal = true
      }
    }

    this._trimHistory()
    this._notify()
  }

  private _trimHistory() {
    let originalLines = 0
    let translationLines = 0
    let keepCount = 0

    for (let i = this.history.length - 1; i >= 0; i--) {
      const entry = this.history[i]
      const hasOriginal = entry.original.trim() ? 1 : 0
      const hasTranslation = entry.translation.trim() ? 1 : 0

      let nextOriginalLines = originalLines
      let nextTranslationLines = translationLines

      if (this.displayMode === "both" || this.displayMode === "original") {
        nextOriginalLines += hasOriginal
      }
      if (this.displayMode === "both" || this.displayMode === "translation") {
        nextTranslationLines += hasTranslation
      }

      const originalOk = (this.displayMode === "translation") || (nextOriginalLines <= this.maxLines)
      const translationOk = (this.displayMode === "original") || (nextTranslationLines <= this.maxLines)

      if ((originalOk && translationOk) || keepCount === 0) {
        originalLines = nextOriginalLines
        translationLines = nextTranslationLines
        keepCount++
      } else {
        break
      }
    }

    while (this.history.length > keepCount) {
      this.history.shift()
    }
  }

  private _notify() {
    const activeEntries = this.history.filter(
      entry => entry.original.trim() || entry.translation.trim(),
    )

    const originalText = this.showOriginal
      ? activeEntries.map(e => e.original.trim()).filter(Boolean).join(" ")
      : ""

    const translationText = activeEntries
      .map(e => e.translation.trim())
      .filter(Boolean)
      .join(" ")

    this.onSubtitleUpdate({
      original: originalText,
      translation: translationText,
      entries: activeEntries.map(e => ({
        original: this.showOriginal ? e.original.trim() : "",
        translation: e.translation.trim()
      }))
    })
  }

  clear() {
    this.history = []
    this._notify()
  }

  /** 清除歷史紀錄但不觸發 onSubtitleUpdate，避免在新語音到達前插入空白更新 */
  clearSilent() {
    this.history = []
  }
}
