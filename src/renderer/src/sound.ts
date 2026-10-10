let ctx: AudioContext | null = null

/** Short two-note ascending chime, synthesized so no audio asset is needed. */
export function playDoneChime(): void {
  ctx ??= new AudioContext()
  const start = ctx.currentTime
  const notes = [
    { freq: 880, at: 0 }, // A5
    { freq: 1318.5, at: 0.14 } // E6
  ]
  for (const { freq, at } of notes) {
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.type = 'sine'
    osc.frequency.value = freq
    gain.gain.setValueAtTime(0.0001, start + at)
    gain.gain.exponentialRampToValueAtTime(0.25, start + at + 0.02)
    gain.gain.exponentialRampToValueAtTime(0.0001, start + at + 0.6)
    osc.connect(gain).connect(ctx.destination)
    osc.start(start + at)
    osc.stop(start + at + 0.65)
  }
}
