#if os(macOS)
import AVFoundation
import Foundation

/// Mac限定: ドパ曲をその場で作曲するシンセ（オフライン生成 → m4a書き出し）
///
/// 仕組み: 音楽理論の制約（進行・スケール・セクション構成）の中をランダムに探索し、
/// キック/クラップ/ハット/ベース/スーパーソウ/リードを波形合成して1曲に組み立てる。
/// ネットワーク不要・無料・完全オフライン。
enum DopaComposer {
    enum Style: String, CaseIterable, Identifiable {
        case dopaTrans = "ドパトランス"
        case megaSabi = "メガサビ"
        case chillDopa = "チルドパ"

        var id: String { rawValue }

        var defaultBPM: Int {
            switch self {
            case .dopaTrans: return 152
            case .megaSabi: return 166
            case .chillDopa: return 118
            }
        }

        var defaultBars: Int {
            switch self {
            case .dopaTrans: return 64
            case .megaSabi: return 64
            case .chillDopa: return 48
            }
        }
    }

    struct Result {
        let fileURL: URL
        let title: String
        let bpm: Int
        let durationSec: Double
        let chorusStart: Double
        let chorusEnd: Double
    }

    struct GeneratedTrack: Identifiable {
        let url: URL
        let title: String
        let createdAt: Date
        var id: String { url.path }
    }

    // MARK: - ファイル

    static var outputDirectory: URL {
        let dir = FileManager.default
            .urls(for: .documentDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("DopaAI", isDirectory: true)
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        return dir
    }

    static func listGenerated() -> [GeneratedTrack] {
        let keys: [URLResourceKey] = [.creationDateKey, .contentModificationDateKey]
        guard
            let items = try? FileManager.default.contentsOfDirectory(
                at: outputDirectory, includingPropertiesForKeys: keys
            )
        else { return [] }
        return items
            .filter { $0.pathExtension.lowercased() == "m4a" }
            .compactMap { url in
                let values = try? url.resourceValues(forKeys: Set(keys))
                let date = values?.creationDate ?? values?.contentModificationDate ?? .distantPast
                return GeneratedTrack(
                    url: url,
                    title: url.deletingPathExtension().lastPathComponent,
                    createdAt: date
                )
            }
            .sorted { $0.createdAt > $1.createdAt }
    }

    static func deleteGenerated(_ url: URL) {
        try? FileManager.default.removeItem(at: url)
    }

    // MARK: - 作曲

    static func compose(style: Style, bpm: Int, bars: Int) throws -> Result {
        var synth = Synth(style: style, bpm: bpm, bars: bars)
        synth.render()

        let url = outputDirectory.appendingPathComponent(
            "\(sanitize(synth.title)).m4a"
        )
        try synth.write(to: url)

        return Result(
            fileURL: url,
            title: synth.title,
            bpm: bpm,
            durationSec: synth.totalDuration,
            chorusStart: synth.chorusStart,
            chorusEnd: synth.chorusEnd
        )
    }

    private static func sanitize(_ name: String) -> String {
        name.replacingOccurrences(of: "/", with: "／")
    }

    // MARK: - シンセ本体

    private struct Synth {
        enum SectionKind {
            case intro, verse, build, sabi, breakdown, final
        }

        let sampleRate = 44_100.0
        let style: Style
        let bpm: Int
        let bars: Int
        let title: String

        var left: [Float]
        var right: [Float]
        let frames: Int
        var chorusStart: Double = 0
        var chorusEnd: Double = 0

        var stepDuration: Double { 60.0 / Double(bpm) / 4.0 }  // 16分音符
        var beatDuration: Double { 60.0 / Double(bpm) }
        var barDuration: Double { beatDuration * 4 }
        var totalDuration: Double { barDuration * Double(bars) }

        init(style: Style, bpm: Int, bars: Int) {
            self.style = style
            self.bpm = bpm
            self.bars = bars
            frames = Int((60.0 / Double(bpm)) * 4 * Double(bars) * 44_100.0)
            left = [Float](repeating: 0, count: frames)
            right = [Float](repeating: 0, count: frames)
            title = Self.makeTitle(style: style, bpm: bpm)
        }

        static func makeTitle(style: Style, bpm: Int) -> String {
            let moods = ["真夜中", "朝まで", "フロア", "ヘッドホン", "帰り道", "放課後", "ネオン", "無限", "最終電車"]
            let nouns = ["ドパドパ", "サビだけ", "ノンストップ", "無限リピート", "メガサビ", "ドパガキ"]
            return "\(moods.randomElement()!)\(nouns.randomElement()!) \(style.rawValue) \(bpm)BPM"
        }

        // MARK: レンダリング

        mutating func render() {
            // マイナー進行（i-VI-III-VII系）をランダムに選ぶ
            let progressions: [[Int]] = [
                [0, -4, 3, -2],   // i VI III VII
                [0, -2, -4, -5],  // i VII VI V
                [0, 3, -4, -2],   // i III VI VII
                [0, -5, -4, -2],  // i V VI VII
                [0, -4, -2, 3],   // i VI VII III
            ]
            let progression = progressions.randomElement()!
            let rootMidi = 57 + Int.random(in: 0...11)
            let leadVariation = Int.random(in: 0...2)

            let plan = sectionPlan()
            var barIndex = 0
            var barStart = 0.0

            for (kind, count) in plan {
                let sectionStart = barStart
                switch kind {
                case .build:
                    riser(at: sectionStart, duration: barDuration * Double(count) * 0.85, gain: 0.32)
                case .sabi, .final:
                    chorusStart = sectionStart
                    chorusEnd = sectionStart + barDuration * Double(count)
                    crash(at: sectionStart, gain: kind == .final ? 1.0 : 0.8)
                default:
                    break
                }

                for barInSection in 0..<count {
                    let chordRoot = rootMidi + progression[barIndex % progression.count]
                    renderBar(
                        kind: kind,
                        barStart: barStart,
                        barInSection: barInSection,
                        sectionBars: count,
                        chordRoot: chordRoot,
                        leadVariation: leadVariation
                    )
                    barStart += barDuration
                    barIndex += 1
                }
            }

            finalize()
        }

        private func sectionPlan() -> [(SectionKind, Int)] {
            let intro = max(4, bars / 8)
            let verse = max(8, bars / 4)
            let build = max(4, bars / 8)
            let sabi = max(8, bars / 4)
            let breakdown = max(2, bars / 16)
            let final = max(4, bars - intro - verse - build - sabi - breakdown)
            return [
                (.intro, intro), (.verse, verse), (.build, build),
                (.sabi, sabi), (.breakdown, breakdown), (.final, final),
            ]
        }

        private mutating func renderBar(
            kind: SectionKind,
            barStart: Double,
            barInSection: Int,
            sectionBars: Int,
            chordRoot: Int,
            leadVariation: Int
        ) {
            let beat = beatDuration
            let step = stepDuration
            let bass = chordRoot - 12
            let stabChord = [chordRoot + 12, chordRoot + 15, chordRoot + 19]
            let scale = [0, 3, 5, 7, 10]  // マイナーペンタトニック

            switch kind {
            case .intro:
                for i in 0..<4 { kick(at: barStart + Double(i) * beat, gain: 0.7) }
                for s in [2, 6, 10, 14] { hat(at: barStart + Double(s) * step, gain: 0.22, open: false) }
                if barInSection % 2 == 1 {
                    stab(at: barStart + 12 * step, duration: step * 2, midis: stabChord, gain: 0.16)
                }

            case .verse:
                for i in 0..<4 { kick(at: barStart + Double(i) * beat, gain: 0.85) }
                clap(at: barStart + beat, gain: 0.5)
                clap(at: barStart + 3 * beat, gain: 0.5)
                for s in stride(from: 2, to: 16, by: 4) {
                    hat(at: barStart + Double(s) * step, gain: 0.3, open: true)
                }
                for i in 0..<8 {
                    if i % 2 == 1 {
                        bassNote(at: barStart + Double(i) * 2 * step, duration: step * 1.8, midi: bass, gain: 0.85)
                    }
                }
                if barInSection % 2 == 0 {
                    for s in [6, 14] {
                        stab(at: barStart + Double(s) * step, duration: step * 2.4, midis: stabChord, gain: 0.2)
                    }
                }

            case .build:
                for i in 0..<4 { kick(at: barStart + Double(i) * beat, gain: 0.85) }
                for s in 0..<16 { hat(at: barStart + Double(s) * step, gain: 0.18, open: false) }
                // 終盤2小節はスネアロール
                if barInSection >= sectionBars - 2 {
                    let rollGain = barInSection == sectionBars - 2 ? 0.28 : 0.42
                    for s in 0..<16 {
                        clap(at: barStart + Double(s) * step, gain: Float(rollGain + Double(s) * 0.015))
                    }
                } else if barInSection % 2 == 1 {
                    clap(at: barStart + beat, gain: 0.35)
                    clap(at: barStart + 3 * beat, gain: 0.35)
                }
                for i in 0..<8 {
                    bassNote(at: barStart + Double(i) * 2 * step, duration: step * 1.8, midi: bass, gain: 0.8)
                }

            case .sabi, .final:
                let octave = kind == .final ? 12 : 0
                for i in 0..<4 { kick(at: barStart + Double(i) * beat, gain: 0.95) }
                clap(at: barStart + beat, gain: 0.55)
                clap(at: barStart + 3 * beat, gain: 0.55)
                for s in stride(from: 2, to: 16, by: 4) {
                    hat(at: barStart + Double(s) * step, gain: 0.32, open: true)
                }
                for s in 0..<16 where s % 4 != 2 {
                    hat(at: barStart + Double(s) * step, gain: 0.1, open: false)
                }
                for s in [6, 14] {
                    stab(
                        at: barStart + Double(s) * step, duration: step * 2.6,
                        midis: stabChord.map { $0 + octave }, gain: 0.3
                    )
                }
                for i in 0..<8 {
                    bassNote(
                        at: barStart + Double(i) * 2 * step, duration: step * 1.8,
                        midi: bass + (i % 4 == 3 ? 12 : 0), gain: 0.85
                    )
                }
                // リードアルペジオ（16分）
                for s in 0..<16 {
                    let tone = scale[(s + leadVariation) % scale.count]
                    let midi = chordRoot + 24 + octave + (s % 8 >= 4 ? tone : tone)
                    lead(
                        at: barStart + Double(s) * step, duration: step * 0.9,
                        midi: midi, gain: 0.16,
                        pan: Double((s % 4) - 2) * 0.2,
                        echo: s % 4 == 0
                    )
                }

            case .breakdown:
                pad(at: barStart, duration: barDuration, midis: [chordRoot, chordRoot + 3, chordRoot + 7, chordRoot + 12], gain: 0.3)
                for s in [0, 6, 10] {
                    let midi = chordRoot + 24 + scale[s % scale.count]
                    lead(at: barStart + Double(s) * step, duration: step * 1.4, midi: midi, gain: 0.14, pan: 0, echo: true)
                }
            }
        }

        private mutating func finalize() {
            // ノーマライズ + ソフトクリップ
            var peak: Float = 0.001
            for i in 0..<frames {
                peak = max(peak, abs(left[i]), abs(right[i]))
            }
            let norm = min(4, 0.92 / peak) * 1.05
            for i in 0..<frames {
                left[i] = tanh(left[i] * norm)
                right[i] = tanh(right[i] * norm)
            }
        }

        func write(to url: URL) throws {
            try? FileManager.default.removeItem(at: url)
            let settings: [String: Any] = [
                AVFormatIDKey: kAudioFormatMPEG4AAC,
                AVSampleRateKey: sampleRate,
                AVNumberOfChannelsKey: 2,
                AVEncoderBitRateKey: 192_000,
            ]
            let file = try AVAudioFile(forWriting: url, settings: settings)
            guard let pcm = AVAudioFormat(standardFormatWithSampleRate: sampleRate, channels: 2),
                let buffer = AVAudioPCMBuffer(pcmFormat: pcm, frameCapacity: 8192)
            else {
                throw ComposerError.writeFailed
            }
            var offset = 0
            while offset < frames {
                let count = min(8192, frames - offset)
                buffer.frameLength = AVAudioFrameCount(count)
                guard let channels = buffer.floatChannelData else { break }
                for i in 0..<count {
                    channels[0][i] = left[offset + i]
                    channels[1][i] = right[offset + i]
                }
                try file.write(from: buffer)
                offset += count
            }
        }

        // MARK: 素材（波形合成）

        private func frequency(_ midi: Int) -> Double {
            440 * pow(2, Double(midi - 69) / 12)
        }

        private mutating func addSample(at time: Double, _ l: Float, _ r: Float) {
            let index = Int(time * sampleRate)
            guard index >= 0, index < frames else { return }
            left[index] += l
            right[index] += r
        }

        private mutating func kick(at time: Double, gain: Float) {
            let duration = 0.36
            let count = Int(duration * sampleRate)
            var phase = 0.0
            for i in 0..<count {
                let t = Double(i) / sampleRate
                let f = 45 + 110 * exp(-t / 0.05)
                phase += 2 * .pi * f / sampleRate
                let env = exp(-t / 0.17)
                var v = sin(phase) * env
                if i < 200 {
                    v += Double.random(in: -0.5...0.5) * (1 - Double(i) / 200) * 0.35
                }
                let out = Float(v * Double(gain))
                addSample(at: time + t, out, out)
            }
        }

        private mutating func clap(at time: Double, gain: Float) {
            let count = Int(0.26 * sampleRate)
            var prev = 0.0
            for i in 0..<count {
                let t = Double(i) / sampleRate
                let burst =
                    exp(-t / 0.018)
                    + 0.65 * exp(-max(0, t - 0.011) / 0.018)
                    + 0.6 * exp(-max(0, t - 0.023) / 0.03)
                let white = Double.random(in: -1...1)
                let high = white - prev
                prev = white
                let out = Float(high * burst * Double(gain) * 0.5)
                addSample(at: time + t, out, out)
            }
        }

        private mutating func hat(at time: Double, gain: Float, open: Bool) {
            let duration = open ? 0.24 : 0.045
            let count = Int(duration * sampleRate)
            var prev = 0.0
            for i in 0..<count {
                let t = Double(i) / sampleRate
                let env = exp(-t / (open ? 0.1 : 0.015))
                let white = Double.random(in: -1...1)
                let high = white - prev
                prev = white
                let out = Float(high * env * Double(gain) * 0.35)
                addSample(at: time + t, out * 0.85, out)
            }
        }

        private mutating func bassNote(at time: Double, duration: Double, midi: Int, gain: Float) {
            let count = Int(duration * sampleRate)
            guard count > 0 else { return }
            var phase = 0.0
            var lp = 0.0
            let inc = frequency(midi) / sampleRate
            for i in 0..<count {
                let t = Double(i) / sampleRate
                let env = min(1, t / 0.006) * exp(-t / (duration * 0.7))
                phase += inc
                if phase > 1 { phase -= 1 }
                let saw = 2 * phase - 1
                let square = phase < 0.5 ? 1.0 : -1.0
                let raw = saw * 0.7 + square * 0.3
                let coef = 0.03 + 0.12 * exp(-t / 0.07)
                lp += coef * (raw - lp)
                let out = Float(lp * env * Double(gain))
                addSample(at: time + t, out, out)
            }
        }

        private mutating func stab(at time: Double, duration: Double, midis: [Int], gain: Float) {
            let count = Int(duration * sampleRate)
            guard count > 0 else { return }
            var voices: [(phase: Double, inc: Double, pan: Double)] = []
            for midi in midis {
                for detune in [-0.09, 0.0, 0.09] {
                    voices.append((
                        phase: Double.random(in: 0...1),
                        inc: frequency(midi) * pow(2, detune / 12) / sampleRate,
                        pan: Double(voices.count % 3 - 1) * 0.25
                    ))
                }
            }
            var lpL = 0.0
            var lpR = 0.0
            for i in 0..<count {
                let t = Double(i) / sampleRate
                let env = min(1, t / 0.005) * exp(-t / (duration * 0.5))
                var mixL = 0.0
                var mixR = 0.0
                for index in voices.indices {
                    voices[index].phase += voices[index].inc
                    if voices[index].phase > 1 { voices[index].phase -= 1 }
                    let saw = 2 * voices[index].phase - 1
                    mixL += saw * (1 - voices[index].pan)
                    mixR += saw * (1 + voices[index].pan)
                }
                let coef = 0.05 + 0.06 * exp(-t / 0.09)
                lpL += coef * (mixL - lpL)
                lpR += coef * (mixR - lpR)
                let g = Double(gain) * env / Double(voices.count) * 0.75
                addSample(at: time + t, Float(lpL * g), Float(lpR * g))
            }
        }

        private mutating func pad(at time: Double, duration: Double, midis: [Int], gain: Float) {
            let count = Int(duration * sampleRate)
            guard count > 0 else { return }
            var voices: [(phase: Double, inc: Double, pan: Double)] = []
            for midi in midis {
                for detune in [-0.06, 0.06] {
                    voices.append((
                        phase: Double.random(in: 0...1),
                        inc: frequency(midi) * pow(2, detune / 12) / sampleRate,
                        pan: Double(voices.count % 4 - 2) * 0.2
                    ))
                }
            }
            var lpL = 0.0
            var lpR = 0.0
            for i in 0..<count {
                let t = Double(i) / sampleRate
                let attack = min(1, t / 0.35)
                let release = min(1, max(0, (duration - t) / 0.4))
                let env = attack * release
                var mixL = 0.0
                var mixR = 0.0
                for index in voices.indices {
                    voices[index].phase += voices[index].inc
                    if voices[index].phase > 1 { voices[index].phase -= 1 }
                    let saw = 2 * voices[index].phase - 1
                    mixL += saw * (1 - voices[index].pan)
                    mixR += saw * (1 + voices[index].pan)
                }
                lpL += 0.02 * (mixL - lpL)
                lpR += 0.02 * (mixR - lpR)
                let g = Double(gain) * env / Double(voices.count)
                addSample(at: time + t, Float(lpL * g), Float(lpR * g))
            }
        }

        private mutating func lead(
            at time: Double, duration: Double, midi: Int, gain: Float, pan: Double, echo: Bool
        ) {
            let offsets: [(delay: Double, gain: Float)] = echo
                ? [(0, Float(1)), (3 * stepDuration, Float(0.3)), (6 * stepDuration, Float(0.14))]
                : [(0, Float(1))]
            for item in offsets {
                tone(
                    at: time + item.delay, duration: duration, midi: midi,
                    gain: gain * item.gain, pan: pan
                )
            }
        }

        private mutating func tone(
            at time: Double, duration: Double, midi: Int, gain: Float, pan: Double
        ) {
            let count = Int(duration * sampleRate)
            guard count > 0 else { return }
            var phase = 0.0
            let inc = frequency(midi) / sampleRate
            let leftGain = Float(0.75 - 0.35 * pan)
            let rightGain = Float(0.75 + 0.35 * pan)
            for i in 0..<count {
                let t = Double(i) / sampleRate
                let env = min(1, t / 0.004) * exp(-t / (duration * 0.5))
                phase += inc
                if phase > 1 { phase -= 1 }
                let wave = phase < 0.25 ? 1.0 : -1.0
                let out = Float(wave * env * Double(gain) * 0.5)
                addSample(at: time + t, out * leftGain, out * rightGain)
            }
        }

        private mutating func riser(at time: Double, duration: Double, gain: Float) {
            let count = Int(duration * sampleRate)
            guard count > 0 else { return }
            var lp = 0.0
            for i in 0..<count {
                let t = Double(i) / sampleRate
                let progress = t / duration
                let white = Double.random(in: -1...1)
                let coef = 0.004 + 0.18 * progress * progress
                lp += coef * (white - lp)
                let env = progress * progress
                let out = Float(lp * env * Double(gain) * 0.6)
                addSample(at: time + t, out, out)
            }
        }

        private mutating func crash(at time: Double, gain: Float) {
            let count = Int(1.3 * sampleRate)
            var prev = 0.0
            for i in 0..<count {
                let t = Double(i) / sampleRate
                let env = exp(-t / 0.38)
                let white = Double.random(in: -1...1)
                let high = white - prev
                prev = white
                let out = Float(high * env * Double(gain) * 0.4)
                addSample(at: time + t, out * 0.9, out)
            }
        }
    }

    enum ComposerError: Error {
        case writeFailed
    }
}
#endif
