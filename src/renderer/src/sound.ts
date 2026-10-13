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

/** Loud, urgent alarm (three bursts of a two-tone square wave) for when an agent needs an answer. */
export function playQuestionAlert(): void {
  ctx ??= new AudioContext()
  const start = ctx.currentTime
  const master = ctx.createGain()
  master.gain.value = 0.6
  master.connect(ctx.destination)
  for (let burst = 0; burst < 3; burst++) {
    for (let beep = 0; beep < 4; beep++) {
      const at = start + burst * 0.7 + beep * 0.12
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.type = 'square'
      osc.frequency.value = beep % 2 === 0 ? 1046.5 : 1568 // C6 / G6
      gain.gain.setValueAtTime(0.0001, at)
      gain.gain.exponentialRampToValueAtTime(0.5, at + 0.01)
      gain.gain.setValueAtTime(0.5, at + 0.09)
      gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.11)
      osc.connect(gain).connect(master)
      osc.start(at)
      osc.stop(at + 0.12)
    }
  }
}
